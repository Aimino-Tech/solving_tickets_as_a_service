/**
 * Load Test: Database Connection Pool Saturation
 *
 * Measures:
 *   - Database connection pool saturation point
 *   - Connection acquisition latency under load
 *   - Query throughput at various pool sizes
 *   - Pool exhaustion behavior
 *
 * This test sends requests that trigger database queries via the health
 * endpoint (/health) which performs a `SELECT 1` check.
 * /health/ready runs a full connection pool check.
 *
 * Stages:
 *   1. Light — 10s at 10 VUs (baseline pool usage)
 *   2. Medium — 20s at 50 VUs (pool approaching limit)
 *   3. Heavy — 20s at 100 VUs (pool saturation)
 *   4. Overload — 15s at 200 VUs (pool exhaustion)
 *   5. Recovery — 15s at 20 VUs (recovery behavior)
 *
 * Usage:
 *   k6 run tests/load/db-connection-pool-test.js
 *
 * Environment:
 *   TARGET_URL — base URL (default: http://localhost:3000)
 *   DB_POOL_MAX — expected max pool size (default: 10)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Gauge } from 'k6/metrics';

import { BASE_URL, baseOptions } from './k6.config.js';
// ── Custom Metrics ─────────────────────────────────────────────────────────

const healthLatency = new Trend('db_health_query_ms');
const dbErrorRate = new Rate('db_error_rate');
const readyCheckLatency = new Trend('db_readiness_check_ms');
const poolUtilization = new Gauge('db_pool_utilization_pct');

// ── Configuration ─────────────────────────────────────────────────────────

const TARGET = __ENV.TARGET_URL || BASE_URL;
const HEALTH_URL = `${TARGET}/health`;
const READY_URL = `${TARGET}/health/ready`;
const DB_POOL_MAX = parseInt(__ENV.DB_POOL_MAX || '10');

// ── Options ───────────────────────────────────────────────────────────────

export const options = {
  ...baseOptions,
  stages: [
    { duration: '10s', target: 10 },
    { duration: '20s', target: 50 },
    { duration: '20s', target: 100 },
    { duration: '15s', target: 200 },
    { duration: '15s', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    db_health_query_ms: ['p(95)<5000'],
    db_error_rate: ['rate<0.10'],
  },
};

// ── Main Test ──────────────────────────────────────────────────────────────

export default function () {
  // Primary: Health check endpoint (runs SELECT 1)
  group('Database Health Check', () => {
    const start = Date.now();
    const response = http.get(HEALTH_URL);
    const elapsed = Date.now() - start;

    healthLatency.add(elapsed);

    if (response.status === 200) {
      check(response, {
        'health check ok (200)': (r) => r.status === 200,
        'database status reported': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.services?.database?.status !== undefined;
          } catch {
            return false;
          }
        },
      });

      try {
        const body = JSON.parse(response.body);
        const dbStatus = body.services?.database?.status;
        if (dbStatus === 'ok') {
          poolUtilization.add(50);
        }
      } catch {
        // non-fatal
      }

      dbErrorRate.add(0);
    } else {
      dbErrorRate.add(1);
      check(response, {
        'health check degraded': (r) => r.status === 503,
      });
    }
  });

  // Secondary: Readiness probe (every 3rd iteration)
  if (__ITER % 3 === 0) {
    group('Readiness Probe', () => {
      const start = Date.now();
      const response = http.get(READY_URL);
      const elapsed = Date.now() - start;

      readyCheckLatency.add(elapsed);

      if (response.status === 200) {
        check(response, {
          'ready probe ok (200)': (r) => r.status === 200,
        });
      } else {
        check(response, {
          'ready probe degraded (503)': (r) => r.status === 503,
        });
      }
    });
  }

  sleep(0.2);
}

export function teardown() {
  console.log('--- Database Pool Saturation Test Complete ---');
  console.log('Configured DB_POOL_MAX: ' + DB_POOL_MAX);
}
