/**
 * Load Test: Mixed Workload — Production Simulation
 *
 * Simulates realistic production traffic mix:
 *   60% — Webhook events (issues.labeled, issues.opened)
 *   20% — Health checks (monitoring services)
 *   10% — Queue health polling (dashboard)
 *   10% — Metrics scraping (Prometheus)
 *
 * Metrics:
 *   - End-to-end latency per operation type
 *   - Error rate per operation type
 *   - Throughput (requests/sec) for mixed traffic
 *   - Resource contention between endpoints
 *
 * Stages:
 *   1. Normal load — 30s at 40 VUs (typical production traffic)
 *   2. Peak load — 30s at 120 VUs (launch day peak)
 *   3. Recovery — 15s at 20 VUs (return to normal)
 *
 * Usage:
 *   k6 run tests/load/mixed-workload-test.js
 *
 * Environment:
 *   TARGET_URL — base URL (default: http://localhost:3000)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

import { BASE_URL, baseOptions } from './k6.config.js';
// ── Custom Metrics ─────────────────────────────────────────────────────────

const webhookLatency = new Trend('mixed_webhook_latency_ms');
const healthLatency = new Trend('mixed_health_latency_ms');
const queueLatency = new Trend('mixed_queue_latency_ms');
const metricsLatency = new Trend('mixed_metrics_latency_ms');
const errorRate = new Rate('mixed_error_rate');
const totalRequests = new Counter('mixed_total_requests');

// ── Configuration ─────────────────────────────────────────────────────────

const TARGET = __ENV.TARGET_URL || BASE_URL;
const WEBHOOK_URL = `${TARGET}/webhook`;
const HEALTH_URL = `${TARGET}/health`;
const QUEUE_HEALTH_URL = `${TARGET}/health/queue`;
const METRICS_URL = `${TARGET}/metrics`;

// ── Options ───────────────────────────────────────────────────────────────

export const options = {
  ...baseOptions,
  stages: [
    { duration: '30s', target: 40 },
    { duration: '30s', target: 120 },
    { duration: '15s', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    mixed_webhook_latency_ms: ['p(95)<3000'],
    mixed_health_latency_ms: ['p(95)<1000'],
    mixed_error_rate: ['rate<0.05'],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function generateWebhookPayload() {
  const repoId = Math.floor(Math.random() * 100);
  return JSON.stringify({
    action: Math.random() > 0.3 ? 'labeled' : 'opened',
    issue: {
      number: Math.floor(Math.random() * 5000) + 1,
      title: 'Mixed workload test issue ' + Math.floor(Math.random() * 1000),
      body: 'Performance testing payload for mixed workload simulation.',
      labels: Math.random() > 0.3
        ? [{ name: 'syntaro:fix' }]
        : [{ name: 'bug' }, { name: 'syntaro:fix' }],
    },
    repository: {
      name: 'mixed-repo-' + repoId,
      full_name: 'mixed-owner/mixed-repo-' + repoId,
      owner: { login: 'mixed-owner' },
    },
    installation: { id: Math.floor(Math.random() * 50) + 8000 },
  });
}

function webhookEventType() {
  const r = Math.random();
  if (r < 0.6) return 'issues.labeled';
  if (r < 0.8) return 'issues.opened';
  if (r < 0.9) return 'issues.edited';
  return 'pull_request.opened';
}

// ── Main Test ──────────────────────────────────────────────────────────────

export default function () {
  const rand = Math.random();

  // 60% webhook events
  if (rand < 0.6) {
    group('Webhook Event', () => {
      const payload = generateWebhookPayload();
      const headers = {
        'Content-Type': 'application/json',
        'X-GitHub-Event': webhookEventType(),
        'X-GitHub-Delivery': 'mixed-' + Math.random().toString(36).substring(2, 15),
        // NOTE: X-Hub-Signature-256 intentionally omitted.
        // The server skips verification when no signature header is present.
      };

      const start = Date.now();
      const response = http.post(WEBHOOK_URL, payload, { headers });
      const elapsed = Date.now() - start;

      webhookLatency.add(elapsed);
      totalRequests.add(1);

      if (response.status === 202) {
        errorRate.add(0);
        check(response, { 'webhook accepted': (r) => r.status === 202 });
      } else {
        errorRate.add(1);
        check(response, { 'webhook failed': (r) => r.status >= 400 });
      }
    });
  }
  // 20% health checks
  else if (rand < 0.8) {
    group('Health Check', () => {
      const start = Date.now();
      const response = http.get(HEALTH_URL);
      const elapsed = Date.now() - start;

      healthLatency.add(elapsed);
      totalRequests.add(1);

      if (response.status === 200) {
        errorRate.add(0);
        check(response, { 'health ok': (r) => r.status === 200 });
      } else {
        errorRate.add(1);
      }
    });
  }
  // 10% queue health polling
  else if (rand < 0.9) {
    group('Queue Health', () => {
      const start = Date.now();
      const response = http.get(QUEUE_HEALTH_URL);
      const elapsed = Date.now() - start;

      queueLatency.add(elapsed);
      totalRequests.add(1);

      if (response.status === 200) {
        errorRate.add(0);
        check(response, { 'queue health ok': (r) => r.status === 200 });
      } else {
        errorRate.add(1);
      }
    });
  }
  // 10% metrics scraping
  else {
    group('Metrics Scrape', () => {
      const start = Date.now();
      const response = http.get(METRICS_URL);
      const elapsed = Date.now() - start;

      metricsLatency.add(elapsed);
      totalRequests.add(1);

      if (response.status === 200) {
        errorRate.add(0);
        check(response, { 'metrics ok': (r) => r.status === 200 });
      } else {
        errorRate.add(1);
      }
    });
  }

  sleep(0.3);
}

export function teardown() {
  console.log('--- Mixed Workload Test Complete ---');
}
