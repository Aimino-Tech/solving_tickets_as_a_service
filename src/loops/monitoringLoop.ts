import { existsSync, openSync, readSync, statSync } from 'node:fs';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { webhookEventsRepository } from '../db/repositories/WebhookEventsRepository.js';
import { runHistoryRepository } from '../db/repositories/RunHistoryRepository.js';
import { getTracker } from '../trackers/index.js';
import { buildTicketDescription } from './issueTemplate.js';
import type { CreateTicketParams } from '../trackers/base.js';
import { Redis } from 'ioredis';

const log = rootLogger.child({ module: 'monitoring-loop' });

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

interface ProcessedError {
  key: string;
  title: string;
  description: string;
  timestamp: string;
}

const PINO_ERROR_LEVEL = 50;
const MAX_TICKETS_PER_CYCLE = 5;
const CONSECUTIVE_FAILURE_LIMIT = 10;
const CIRCUIT_BREAKER_TTL_MS = 5 * 60 * 1000;

export interface MonitoringStats {
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  logFilePath: string;
  logFileSize: number;
  logFilePosition: number;
  totalWebhookErrors: number;
  totalRunErrors: number;
  totalLogErrors: number;
  totalTicketsCreated: number;
  lastError: string | null;
}

export class MonitoringLoop {
  private enabled: boolean;
  private intervalMs: number;
  private teamId: string;
  private projectId?: string;
  private defaultAccountId?: number;
  private logFilePath: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private redis: Redis | null = null;
  private redisReady = false;

  private consecutiveFailures = 0;
  private circuitBreakerOpenUntil: number | null = null;

  private stats = {
    lastRunAt: null as string | null,
    totalWebhookErrors: 0,
    totalRunErrors: 0,
    totalLogErrors: 0,
    totalTicketsCreated: 0,
    lastError: null as string | null,
  };

  private isCircuitBreakerOpen(): boolean {
    if (this.circuitBreakerOpenUntil === null) return false;
    if (Date.now() >= this.circuitBreakerOpenUntil) {
      log.info('Circuit breaker reset — cooling period elapsed');
      this.circuitBreakerOpenUntil = null;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  getStats(): MonitoringStats {
    let logFileSize = 0;
    let logFilePosition = 0;
    try { logFileSize = statSync(this.logFilePath).size; } catch { /* ignore */ }

    return {
      enabled: this.enabled,
      running: this.running,
      lastRunAt: this.stats.lastRunAt,
      logFilePath: this.logFilePath,
      logFileSize,
      logFilePosition,
      totalWebhookErrors: this.stats.totalWebhookErrors,
      totalRunErrors: this.stats.totalRunErrors,
      totalLogErrors: this.stats.totalLogErrors,
      totalTicketsCreated: this.stats.totalTicketsCreated,
      lastError: this.stats.lastError,
    };
  }

  constructor() {
    this.enabled = config.monitoringLoop?.enabled ?? false;
    this.intervalMs = config.monitoringLoop?.intervalMs ?? 10_000;
    this.teamId = config.monitoringLoop?.teamId ?? '';
    this.projectId = config.monitoringLoop?.projectId;
    this.defaultAccountId = config.monitoringLoop?.defaultAccountId;
    this.logFilePath = config.logFile ?? '';
  }

  private async connectRedis(): Promise<void> {
    if (this.redisReady) return;
    try {
      this.redis = new Redis(config.queue.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy: () => null,
      });
      await this.redis.connect();
      this.redisReady = true;
      log.info('Monitoring loop: Redis connected');
    } catch (err) {
      this.redisReady = false;
      log.warn({ err: String(err) }, 'Monitoring loop: Redis connection failed — dedup disabled');
    }
  }

  private async redisGet(key: string): Promise<string | null> {
    if (!this.redisReady || !this.redis) return null;
    try { return await this.redis.get(key); } catch { return null; }
  }

  private async redisSet(key: string, value: string, ttl = 86400): Promise<void> {
    if (!this.redisReady || !this.redis) return;
    try {
      if (ttl > 0) {
        await this.redis.setex(key, ttl, value);
      } else {
        await this.redis.set(key, value);
      }
    } catch { /* ignore */ }
  }

  start(): void {
    if (!this.enabled) {
      log.info('Monitoring loop disabled — skipping');
      return;
    }
    if (!this.teamId) {
      log.warn('MONITORING_LOOP_TEAM_ID not configured — monitoring loop disabled');
      return;
    }
    if (this.timer) {
      log.warn('Monitoring loop already running');
      return;
    }

    this.connectRedis().catch(() => {});
    log.info({ intervalMs: this.intervalMs, logFile: this.logFilePath || 'none' }, 'Starting monitoring loop (every 10s)');
    this.runOnce().catch((err) => log.error({ err: String(err) }, 'Initial monitoring loop run failed'));
    this.timer = setInterval(() => {
      this.runOnce().catch((err) => log.error({ err: String(err) }, 'Monitoring loop run failed'));
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    if (this.redis) {
      try { this.redis.quit(); } catch { /* ignore */ }
      this.redis = null;
      this.redisReady = false;
    }
    log.info('Monitoring loop stopped');
  }

  private async runOnce(): Promise<void> {
    if (this.running) {
      log.debug('Previous monitoring loop still running — skipping');
      return;
    }
    this.running = true;

    try {
      const now = new Date().toISOString();
      this.stats.lastRunAt = now;

      const errors: ProcessedError[] = [];

      const [webhookErrors, runErrors, logErrors] = await Promise.all([
        this.scanWebhookEvents(),
        this.scanRunHistory(),
        this.scanLogFile(),
      ]);

      errors.push(...webhookErrors, ...runErrors, ...logErrors);
      this.stats.totalWebhookErrors += webhookErrors.length;
      this.stats.totalRunErrors += runErrors.length;
      this.stats.totalLogErrors += logErrors.length;

      if (logErrors.length > 0) {
        log.info({ count: logErrors.length }, 'Monitoring loop: log file errors detected');
      }

      if (errors.length === 0) {
        log.info('Monitoring loop: scan complete — no new errors');
        return;
      }

      const batch = errors.slice(0, MAX_TICKETS_PER_CYCLE);
      if (batch.length < errors.length) {
        log.warn({ total: errors.length, capped: batch.length }, 'Monitoring loop: capping tickets per cycle');
      }

      if (this.isCircuitBreakerOpen()) {
        const remainingMs = this.circuitBreakerOpenUntil! - Date.now();
        log.warn({ remainingMs, consecutiveFailures: this.consecutiveFailures }, 'Monitoring loop: circuit breaker open — skipping ticket creation');
        return;
      }

      log.info({ errorCount: batch.length, totalErrors: errors.length }, 'Monitoring loop: new errors detected, creating tickets');

      const tracker = getTracker('linear');
      if (!tracker) {
        log.warn('Linear tracker not available — skipping ticket creation');
        return;
      }

      let created = 0;
      for (const err of batch) {
        try {
          const dup = await this.redisGet(`monitoring:dup:${err.key}`);
          if (dup) {
            log.debug({ key: err.key }, 'Skipping duplicate error');
            continue;
          }

          const params: CreateTicketParams = {
            teamId: this.teamId,
            projectId: this.projectId,
            title: err.title,
            description: err.description,
            priority: 2,
          };

          const ticket = await tracker.createTicket(params);
          created++;
          this.consecutiveFailures = 0;

          await this.redisSet(`monitoring:dup:${err.key}`, ticket.url, 86400);

          log.info({ key: err.key, ticketUrl: ticket.url }, 'MonitoringLoop: created ticket');
        } catch (createErr) {
          this.consecutiveFailures++;
          this.stats.lastError = String(createErr).slice(0, 500);

          const errStr = String(createErr);
          let errorType = 'unknown';
          if (errStr.includes('429') || errStr.includes('rate limit')) errorType = 'rate_limited';
          else if (errStr.includes('401') || errStr.includes('unauthorized')) errorType = 'auth_error';
          else if (errStr.includes('403') || errStr.includes('forbidden')) errorType = 'forbidden';
          else if (errStr.includes('timeout') || errStr.includes('ETIMEDOUT')) errorType = 'network_timeout';
          else if (errStr.includes('ENOTFOUND') || errStr.includes('ECONNREFUSED')) errorType = 'network_error';

          log.error({
            err: errStr.slice(0, 500),
            key: err.key,
            errorType,
            consecutiveFailures: this.consecutiveFailures,
          }, 'MonitoringLoop: failed to create ticket');

          if (this.consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
            this.circuitBreakerOpenUntil = Date.now() + CIRCUIT_BREAKER_TTL_MS;
            log.error({
              consecutiveFailures: this.consecutiveFailures,
              coolingPeriodMs: CIRCUIT_BREAKER_TTL_MS,
            }, 'MonitoringLoop: circuit breaker opened — too many consecutive failures');
          }
        }
      }
      this.stats.totalTicketsCreated += created;

      if (created > 0) {
        log.info({ created, total: this.stats.totalTicketsCreated }, 'MonitoringLoop: batch complete');
      }
    } catch (err) {
      this.stats.lastError = String(err).slice(0, 500);
      log.error({ err: String(err) }, 'Monitoring loop encountered an error');
    } finally {
      this.running = false;
    }
  }

  private async scanWebhookEvents(): Promise<ProcessedError[]> {
    const errors: ProcessedError[] = [];
    try {
      const { events } = await webhookEventsRepository.list({ status: 'failed', limit: 50 });
      for (const event of events) {
        errors.push({
          key: `webhook:${event.id}`,
          title: `[Monitoring] Webhook failure: ${event.eventType}`,
          description: buildTicketDescription({
            input: `Webhook event from ${event.source} (type: ${event.eventType}) failed to process`,
            output: event.lastError || 'Unknown error — no error details recorded',
            context: {
              what: 'Webhook processing failure',
              how: 'Webhook handler returned error status',
              where: `source=${event.source}, eventType=${event.eventType}, id=${event.id}`,
              when: event.createdAt?.toISOString?.() ?? new Date().toISOString(),
              result: 'Webhook event marked as failed after processing',
            },
            acceptanceCriteria: [
              'Webhook events process without failure',
              'Error rate for webhooks below acceptable threshold',
            ],
          }),
          timestamp: event.createdAt?.toISOString?.() ?? new Date().toISOString(),
        });
      }
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to scan webhook events');
    }
    return errors;
  }

  private async scanLogFile(): Promise<ProcessedError[]> {
    const errors: ProcessedError[] = [];
    if (!this.logFilePath) return errors;
    if (!existsSync(this.logFilePath)) return errors;

    try {
      const logFileSize = statSync(this.logFilePath).size;
      const posStr = await this.redisGet('monitoring:log:position');
      const position = posStr ? Number(posStr) : 0;

      if (logFileSize <= position) return errors;

      const fd = openSync(this.logFilePath, 'r');
      const buffer = Buffer.alloc(logFileSize - position);
      readSync(fd, buffer, 0, buffer.length, position);

      const content = buffer.toString('utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const pinoLevel = entry.level as number;

          if (pinoLevel < 50) continue;
          if (entry.module === 'monitoring-loop') continue;
          if (entry.module === 'webhook-event-logger') continue;

          const errMsg = entry.err?.message || entry.msg || 'Unknown error';
          const errStack = entry.err?.stack || '';
          const hash = simpleHash(`${entry.module}:${errMsg}`);

          errors.push({
            key: `log:${hash}`,
            title: `[Monitoring] App error: ${(entry.module || 'unknown')} — ${errMsg.slice(0, 120)}`,
            description: buildTicketDescription({
              input: `STAS app log entry at level ${pinoLevel}`,
              output: errMsg,
              context: {
                what: entry.module || 'unknown module',
                how: errStack || errMsg,
                where: `${entry.hostname || 'localhost'} (pid: ${entry.pid || '?'})`,
                when: entry.time ? new Date(entry.time).toISOString() : new Date().toISOString(),
                result: `Log level: ${pinoLevel === 50 ? 'ERROR' : 'FATAL'}`,
              },
              acceptanceCriteria: [
                'No ERROR level log entries in the app log',
                'Error rate within acceptable threshold',
              ],
            }),
            timestamp: entry.time ? new Date(entry.time).toISOString() : new Date().toISOString(),
          });
        } catch {
          // skip malformed JSON lines
        }
      }

      await this.redisSet('monitoring:log:position', String(logFileSize), 0);
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to scan log file');
    }
    return errors;
  }

  private async scanRunHistory(): Promise<ProcessedError[]> {
    const errors: ProcessedError[] = [];
    if (!this.defaultAccountId) return errors;

    try {
      const runs = await runHistoryRepository.listByAccount(this.defaultAccountId, 50, 0);
      const failedRuns = runs.filter((r) => r.status === 'failed');

      for (const run of failedRuns) {
        errors.push({
          key: `run:${run.id}`,
          title: `[Monitoring] Failed fix run #${run.id}`,
          description: buildTicketDescription({
            input: `Fix run #${run.id} for ${run.repo ?? 'unknown repo'} failed`,
            output: run.result || 'No error details available from run history',
            context: {
              what: 'Fix run execution failure',
              how: 'Agent pipeline returned failed status',
              where: `repo=${run.repo ?? 'N/A'}, runId=${run.id}, accountId=${run.accountId}`,
              when: run.completedAt?.toISOString?.() ?? new Date().toISOString(),
              result: 'Run completed with failed status',
            },
            acceptanceCriteria: [
              'Fix runs complete without failure',
              'Success rate for fix runs meets SLO targets',
            ],
          }),
          timestamp: run.completedAt?.toISOString?.() ?? new Date().toISOString(),
        });
      }
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to scan run history');
    }
    return errors;
  }
}

export let monitoringLoop: MonitoringLoop | null = null;

export function startMonitoringLoop(): void {
  monitoringLoop = new MonitoringLoop();
  monitoringLoop.start();
}

export function stopMonitoringLoop(): void {
  if (monitoringLoop) monitoringLoop.stop();
}
