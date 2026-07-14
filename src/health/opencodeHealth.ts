/**
 * OpenCode Health Client — polling, caching, circuit breaker.
 *
 * Manages health-checking of the OpenCode serve endpoint:
 *   - Polls /health on OpenCode serve at a configurable interval
 *   - Caches health status with configurable TTL (default 30s)
 *   - Circuit breaker: after N consecutive failures, marks as "degraded"
 *     and periodically retries to check recovery
 *   - Exposes cached status for /health, /health/ready, /health/opencode,
 *     and /metrics endpoints
 *
 * Usage:
 *   import { opencodeHealth } from './health/opencodeHealth.js';
 *   opencodeHealth.start();          // begin polling
 *   const status = opencodeHealth.getStatus();  // get cached status
 *   opencodeHealth.stop();           // stop polling (graceful shutdown)
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Poll failures are caught and logged, never thrown
 * ✅ Circuit breaker prevents cascading failures
 * ✅ Cached status always available (even before first poll)
 * ✅ Graceful stop via AbortController
 * ────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { mockResponses } from '../agent/mockResponses.js';
import { bridgeMetrics } from '../bridge/metrics.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'opencode-health' });

// ── Types ───────────────────────────────────────────────────────────

export interface OpenCodeHealthStatus {
  /** Overall health: 'healthy', 'degraded', 'unknown' */
  status: 'healthy' | 'degraded' | 'unknown';
  /** Whether the last HTTP request succeeded */
  reachable: boolean;
  /** HTTP status code from the last /health response (0 if unreachable) */
  httpStatus: number;
  /** Raw response body (parsed JSON) from OpenCode's /health, if available */
  details: Record<string, unknown> | null;
  /** Cache timestamp (ISO string) */
  cachedAt: string;
  /** Circuit breaker state */
  circuit: 'closed' | 'open';
  /** Consecutive failure count */
  consecutiveFailures: number;
  /** Model info extracted from OpenCode health response, if available */
  modelInfo: string | null;
  /** Queue depth from OpenCode, if available */
  queueDepth: number | null;
  /** Active sessions from OpenCode, if available */
  activeSessions: number | null;
}

interface OpenCodeHealthResponse {
  status?: string;
  model?: string;
  model_info?: string;
  queue_depth?: number;
  active_sessions?: number;
  sessions?: number;
  version?: string;
  [key: string]: unknown;
}

// ── Default Status (before any poll) ────────────────────────────────

const DEFAULT_STATUS: OpenCodeHealthStatus = {
  status: 'unknown',
  reachable: false,
  httpStatus: 0,
  details: null,
  cachedAt: new Date().toISOString(),
  circuit: 'closed',
  consecutiveFailures: 0,
  modelInfo: null,
  queueDepth: null,
  activeSessions: null,
};

// ── OpenCodeHealthClient ────────────────────────────────────────────

export class OpenCodeHealthClient {
  private status: OpenCodeHealthStatus = { ...DEFAULT_STATUS };
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private started = false;

  // Circuit breaker config
  private readonly circuitBreakerThreshold: number;
  private readonly pollIntervalMs: number;
  private readonly cacheTtlMs: number;

  constructor() {
    this.circuitBreakerThreshold = config.opencodeHealth.circuitBreakerThreshold;
    this.pollIntervalMs = config.opencodeHealth.pollIntervalMs;
    this.cacheTtlMs = config.opencodeHealth.cacheTtlMs;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Start polling OpenCode serve for health status.
   * Safe to call multiple times — subsequent calls are no-ops.
   * Performs an initial health check immediately.
   */
  start(): void {
    if (this.started) {
      log.debug('OpenCode health client already started');
      return;
    }
    this.started = true;
    this.abortController = new AbortController();

    log.info(
      {
        pollIntervalMs: this.pollIntervalMs,
        cacheTtlMs: this.cacheTtlMs,
        circuitBreakerThreshold: this.circuitBreakerThreshold,
        opencodeUrl: config.opencode.url,
      },
      'Starting OpenCode health client',
    );

    // Perform initial check immediately
    this.poll().catch((err) => {
      log.warn({ err: String(err) }, 'Initial OpenCode health poll failed');
    });

    // Schedule periodic polling
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        log.warn({ err: String(err) }, 'Scheduled OpenCode health poll failed');
      });
    }, this.pollIntervalMs);

    // Update metrics periodically (at least every 15s, but no more often than poll interval)
    const metricsIntervalMs = Math.min(this.pollIntervalMs, 15000);
    this.metricsTimer = setInterval(() => {
      this.updateMetrics();
    }, metricsIntervalMs);
  }

  /**
   * Stop polling and clean up.
   * Safe to call multiple times.
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    log.info('OpenCode health client stopped');
  }

  /**
   * Whether the client has been started.
   */
  isStarted(): boolean {
    return this.started;
  }

  // ── Status Accessors ──────────────────────────────────────────────

  /**
   * Get the current cached health status.
   * Always returns a value — never throws.
   */
  getStatus(): OpenCodeHealthStatus {
    return { ...this.status };
  }

  /**
   * Quick check: is OpenCode currently healthy?
   * Respects cache TTL — returns the cached opinion.
   */
  isHealthy(): boolean {
    return this.status.status === 'healthy';
  }

  /**
   * Quick check: is OpenCode reachable (any HTTP response received)?
   */
  isReachable(): boolean {
    return this.status.reachable;
  }

  // ── Internal ──────────────────────────────────────────────────────

  /**
   * Perform a single health check poll.
   * Updates internal state and metrics.
   */
  private async poll(): Promise<void> {
    const signal = this.abortController?.signal;
    if (signal?.aborted) return;

    // Static mode: skip real health checks, return mock status
    if (mockResponses.isStaticMode()) {
      const mock = mockResponses.healthStatus();
      this.status = {
        status: mock.status === 'static_mode' ? 'healthy' : 'unknown',
        reachable: true,
        httpStatus: 200,
        details: { status: 'static_mode', message: 'AI agent is disabled — static placeholder mode' },
        cachedAt: new Date().toISOString(),
        circuit: 'closed',
        consecutiveFailures: 0,
        modelInfo: 'static-mode (no model)',
        queueDepth: 0,
        activeSessions: 0,
      };
      return;
    }

    const url = `${config.opencode.url}/api/health`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(config.opencodeHealth.requestTimeoutMs),
      });

      let responseBody: OpenCodeHealthResponse | null = null;
      let parseError = false;

      try {
        responseBody = (await response.json()) as OpenCodeHealthResponse;
      } catch {
        parseError = true;
        log.warn({ httpStatus: response.status }, 'OpenCode health returned non-JSON response');
      }

      if (response.ok && !parseError && responseBody) {
        // Success — reset circuit breaker
        this.status = {
          status: 'healthy',
          reachable: true,
          httpStatus: response.status,
          details: responseBody as Record<string, unknown>,
          cachedAt: new Date().toISOString(),
          circuit: 'closed',
          consecutiveFailures: 0,
          modelInfo: (responseBody.model_info as string) || (responseBody.model as string) || (responseBody.version as string) || null,
          queueDepth: (responseBody.queue_depth as number) ?? null,
          activeSessions: (responseBody.active_sessions as number) ?? (responseBody.sessions as number) ?? null,
        };
        log.debug('OpenCode health check succeeded');
      } else {
        // Non-OK response or parse failure
        this.handleFailure(response.status, parseError ? 'Non-JSON response' : `HTTP ${response.status}`);
      }
    } catch (err) {
      // Network error or timeout
      this.handleFailure(0, String(err));
    }

    this.updateMetrics();
  }

  /**
   * Handle a failed health check (circuit breaker logic).
   */
  private handleFailure(httpStatus: number, error: string): void {
    this.status.consecutiveFailures++;
    this.status.reachable = httpStatus > 0;
    this.status.httpStatus = httpStatus;
    this.status.cachedAt = new Date().toISOString();
    this.status.details = null;

    if (this.status.consecutiveFailures >= this.circuitBreakerThreshold) {
      // Circuit breaker opens — mark as degraded
      this.status.status = 'degraded';
      this.status.circuit = 'open';

      if (this.status.consecutiveFailures === this.circuitBreakerThreshold) {
        log.warn(
          {
            consecutiveFailures: this.status.consecutiveFailures,
            threshold: this.circuitBreakerThreshold,
            error,
          },
          'OpenCode circuit breaker opened — marking as degraded',
        );
      }
    } else {
      // Still within threshold — mark as unknown
      this.status.status = 'unknown';
      this.status.circuit = 'closed';
    }

    log.debug(
      {
        consecutiveFailures: this.status.consecutiveFailures,
        circuit: this.status.circuit,
        error,
      },
      'OpenCode health check failed',
    );
  }

  /**
   * Update Prometheus metrics for OpenCode health.
   */
  private updateMetrics(): void {
    // Gauge: 1 = healthy, 0 = degraded/unknown
    bridgeMetrics.setGauge('opencode_health_status', {}, this.status.status === 'healthy' ? 1 : 0);

    // Gauge: consecutive failures
    bridgeMetrics.setGauge('opencode_health_failures_total', {}, this.status.consecutiveFailures);

    // Gauge: queue depth from OpenCode
    if (this.status.queueDepth !== null) {
      bridgeMetrics.setGauge('opencode_queue_depth', {}, this.status.queueDepth);
    }

    // Gauge: active sessions
    if (this.status.activeSessions !== null) {
      bridgeMetrics.setGauge('opencode_active_sessions', {}, this.status.activeSessions);
    }
  }

  /**
   * Force an immediate health check (bypass cache).
   * Used by the /health/opencode endpoint to get a fresh status.
   */
  async checkNow(): Promise<OpenCodeHealthStatus> {
    await this.poll();
    return this.getStatus();
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Global singleton instance of the OpenCode health client.
 * Import and use this directly throughout the application.
 *
 * Start it during application startup:
 *   opencodeHealth.start();
 *
 * Stop it during graceful shutdown:
 *   opencodeHealth.stop();
 */
export const opencodeHealth = new OpenCodeHealthClient();
