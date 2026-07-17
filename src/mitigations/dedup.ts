/**
 * Two-layer deduplication for GitHub webhook events.
 *
 * Layer 1 — Delivery ID dedup:
 *   Redis SETNX with 24h TTL. The GitHub `X-GitHub-Delivery` header provides
 *   a unique delivery ID. This prevents processing the same webhook delivery twice.
 *   Fail-closed: returns true on Redis error (conservative — assume duplicate).
 *
 * Layer 2 — Issue identity dedup:
 *   Redis SETNX keyed by the issue's unique identity (owner/name/issue number).
 *   TTL is set to the pipeline's expected duration, preventing duplicate
 *   processing of the same issue while a pipeline is active.
 *
 * ── Key format ───────────────────────────────────────────────────────
 *   stas:dedup:delivery:{deliveryId}   → "1" (24h TTL)
 *   stas:dedup:issue:{owner}:{name}:{issueNumber} → "1" (pipeline duration TTL)
 * ─────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'dedup' });

const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_ISSUE_TTL_MS = 30 * 60 * 1000;  // 30 minutes

export class DedupEngine {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, 'Dedup Redis retry in ${delay}ms');
        return delay;
      },
      lazyConnect: true,
    });

    this.redis.on('error', (err: Error) => {
      log.error({ err: String(err) }, 'Dedup Redis connection error');
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.redis.status || this.redis.status === 'end' || this.redis.status === 'close') {
      await this.redis.connect();
    }
  }

  // ── Layer 1: Delivery ID dedup ────────────────────────────────────

  /**
   * Check if a GitHub delivery ID has already been processed.
   *
   * Uses SETNX with a 24h TTL. On first call for a given deliveryId,
   * sets the key and returns true (not a duplicate).
   * On subsequent calls, returns false (duplicate).
   *
   * Fail-closed: returns true on Redis error (assume duplicate to be safe).
   *
   * @returns true if the delivery is NOT a duplicate (first time seen)
   */
  async checkDelivery(deliveryId: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      const key = `stas:dedup:delivery:${deliveryId}`;
      const result = await this.redis.set(key, '1', 'PX', DELIVERY_TTL_MS, 'NX');
      return result === 'OK';
    } catch (err) {
      log.error({ err: String(err), deliveryId }, 'Delivery dedup check failed — fail-closed');
      return true; // fail-closed: assume not a duplicate
    }
  }

  // ── Layer 2: Issue identity dedup ─────────────────────────────────

  /**
   * Check if an issue is already being processed.
   *
   * Uses SETNX with a TTL matching the expected pipeline duration.
   * This prevents launching duplicate pipelines for the same issue.
   *
   * Fail-closed: returns true on Redis error (assume not duplicate).
   *
   * @returns true if the issue is NOT a duplicate (first time seen)
   */
  async checkIssue(
    owner: string,
    name: string,
    issueNumber: number,
    pipelineDurationMs: number = DEFAULT_ISSUE_TTL_MS,
  ): Promise<boolean> {
    try {
      await this.ensureConnected();
      const key = `stas:dedup:issue:${owner}:${name}:${issueNumber}`;
      const result = await this.redis.set(key, '1', 'PX', pipelineDurationMs, 'NX');
      return result === 'OK';
    } catch (err) {
      log.error({ err: String(err), owner, name, issueNumber }, 'Issue dedup check failed — fail-closed');
      return true; // fail-closed: assume not a duplicate
    }
  }

  /**
   * Manually release an issue dedup lock before its TTL expires.
   */
  async releaseIssue(owner: string, name: string, issueNumber: number): Promise<void> {
    try {
      await this.ensureConnected();
      const key = `stas:dedup:issue:${owner}:${name}:${issueNumber}`;
      await this.redis.del(key);
    } catch (err) {
      log.warn({ err: String(err), owner, name, issueNumber }, 'Issue dedup release failed');
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing DedupEngine Redis');
    }
  }
}
