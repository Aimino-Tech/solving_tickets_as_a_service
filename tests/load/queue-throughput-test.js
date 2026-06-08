/**
 * Load Test: Queue Throughput & Worker Concurrency
 *
 * Measures:
 *   - Max concurrent agent runs (single worker)
 *   - BullMQ queue throughput limits
 *   - Job enqueue/dequeue rates
 *
 * This test simulates queue operations by hitting the health/queue endpoint
 * and the enqueue flow. In production, run this against an actual STAS instance
 * with Redis/BullMQ configured.
 *
 * Stages:
 *   1. Warm-up — 10s at 5 VUs (connection establishment)
 *   2. Throughput — 30s at 30 VUs (steady enqueue rate)
 *   3. Saturation — 20s at 80 VUs (find queue bottleneck)
 *   4. Cooldown — 10s to 0 VUs
 *
 * Usage:
 *   k6 run tests/load/queue-throughput-test.js
 *
 * Environment:
 *   TARGET_URL — base URL (default: http://localhost:3000)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Gauge } from 'k6/metrics';

// ── Custom Metrics ─────────────────────────────────────────────────────────

const enqueueLatency = new Trend('queue_enqueue_time_ms');
const queueDepth = new Gauge('queue_depth');
const workerActive = new Gauge('worker_active_jobs');
const enqueueSuccess = new Rate('enqueue_success_rate');
const enqueueFailure = new Rate('enqueue_failure_rate');

// ── Configuration ─────────────────────────────────────────────────────────

const TARGET = __ENV.TARGET_URL || 'http://localhost:3000';
const WEBHOOK_URL = `${TARGET}/webhook`;
const QUEUE_HEALTH_URL = `${TARGET}/health/queue`;
const HEALTH_URL = `${TARGET}/health`;

// ── Options ───────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '30s', target: 30 },
    { duration: '20s', target: 80 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    queue_enqueue_time_ms: ['p(95)<3000'],
    enqueue_success_rate: ['rate>0.95'],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function generateJobPayload() {
  return JSON.stringify({
    action: 'labeled',
    issue: {
      number: Math.floor(Math.random() * 10000) + 1,
      title: 'Load test issue #' + Math.floor(Math.random() * 1000),
      body: 'Automated load test payload for queue throughput measurement.',
      labels: [{ name: 'stas:fix' }],
    },
    repository: {
      name: 'loadtest-repo-' + Math.floor(Math.random() * 50),
      full_name: 'loadtest-owner/loadtest-repo-' + Math.floor(Math.random() * 50),
      owner: { login: 'loadtest-owner' },
    },
    installation: {
      id: Math.floor(Math.random() * 100) + 9000,
    },
  });
}

// ── Main Test ──────────────────────────────────────────────────────────────

export default function () {
  // Phase 1: Enqueue job (simulate webhook trigger)
  group('Job Enqueue', () => {
    const payload = generateJobPayload();
    const headers = {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'issues.labeled',
      'X-GitHub-Delivery': 'load-' + Math.random().toString(36).substring(2, 15),
      'X-Hub-Signature-256': 'sha256=' + Math.random().toString(36).substring(2, 66),
    };

    const start = Date.now();
    const response = http.post(WEBHOOK_URL, payload, { headers });
    const elapsed = Date.now() - start;

    enqueueLatency.add(elapsed);

    if (response.status === 202) {
      enqueueSuccess.add(1);
      check(response, {
        'job enqueued (202)': (r) => r.status === 202,
      });
    } else if (response.status === 429) {
      enqueueFailure.add(1);
      check(response, { 'rate limited (429)': (r) => r.status === 429 });
    } else {
      enqueueFailure.add(1);
      check(response, { 'enqueue failed': (r) => r.status < 500 });
    }
  });

  // Phase 2: Check queue health (every 5th iteration)
  if (__ITER % 5 === 0) {
    group('Queue Health Check', () => {
      const response = http.get(QUEUE_HEALTH_URL);
      check(response, {
        'queue health endpoint ok': (r) => r.status === 200,
      });

      if (response.status === 200) {
        try {
          const body = JSON.parse(response.body);
          if (body.depth !== undefined) queueDepth.add(body.depth);
          if (body.activeJobs !== undefined) workerActive.add(body.activeJobs);
        } catch (e) {
          // non-fatal
        }
      }
    });
  }

  // Phase 3: General health check (every 10th iteration)
  if (__ITER % 10 === 0) {
    group('Health Check', () => {
      const response = http.get(HEALTH_URL);
      check(response, {
        'health endpoint ok': (r) => r.status === 200,
      });
    });
  }

  sleep(0.5);
}

export function teardown() {
  console.log('--- Queue Throughput Test Complete ---');
}
