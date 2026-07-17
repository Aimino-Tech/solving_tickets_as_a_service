/**
 * k6 Load Test — Webhook Simulation
 *
 * Simulates N concurrent GitHub webhook deliveries to STAS.
 * Measures throughput, latency (p50/p95/p99), error rate, and
 * validates that the system can sustain 500-user peak load.
 *
 * Usage:
 *   k6 run scripts/load-test/webhook.js
 *
 * Environment variables:
 *   TARGET_URL    — STAS webhook endpoint (default: http://localhost:3000/webhook)
 *   WEBHOOK_SECRET — GitHub webhook secret for signature (default: test-secret)
 *   VU            — Number of virtual users (default: 50)
 *   DURATION      — Test duration (default: 5m)
 *   RAMP_UP       — Ramp-up period (default: 30s)
 *
 * Expected thresholds for 500-user capacity:
 *   - p95 latency < 2000ms
 *   - error rate < 1%
 *   - throughput > 50 req/s sustained
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ───────────────────────────────────────────────────────────

const webhookDuration = new Trend('webhook_duration_ms', true);
const webhookSuccessRate = new Rate('webhook_success_rate');
const webhookFailures = new Counter('webhook_failures');
const webhookTotal = new Counter('webhook_total');

// ── Configuration ────────────────────────────────────────────────────────────

const TARGET_URL = __ENV.TARGET_URL || 'http://localhost:3000/webhook';
const WEBHOOK_SECRET = __ENV.WEBHOOK_SECRET || 'test-secret';

// Simulated GitHub issue payload shapes
const ISSUE_EVENTS = [
  'issues',
  'issue_comment',
  'pull_request',
  'push',
];

function generatePayload(eventType) {
  const base = {
    action: 'opened',
    installation: { id: Math.floor(Math.random() * 10000) + 1 },
    sender: { login: `test-user-${Math.floor(Math.random() * 500) + 1}` },
    repository: {
      id: Math.floor(Math.random() * 5000) + 1,
      name: `test-repo-${Math.floor(Math.random() * 100) + 1}`,
      owner: { login: 'test-org' },
      private: Math.random() > 0.5,
    },
  };

  switch (eventType) {
    case 'issues':
      return {
        ...base,
        issue: {
          number: Math.floor(Math.random() * 10000) + 1,
          title: `Test issue ${Date.now()}`,
          body: 'This is a test issue for load testing purposes.',
          labels: [{ name: 'stas:fix' }],
        },
      };
    case 'issue_comment':
      return {
        ...base,
        issue: { number: Math.floor(Math.random() * 10000) + 1 },
        comment: { body: 'Test comment for load testing.' },
      };
    case 'pull_request':
      return {
        ...base,
        pull_request: {
          number: Math.floor(Math.random() * 10000) + 1,
          title: `Test PR ${Date.now()}`,
          head: { ref: 'feature/test' },
          base: { ref: 'main' },
        },
      };
    default:
      return base;
  }
}

// ── k6 options ──────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    webhook_load: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: parseInt(__ENV.VU || '50', 10),
      maxVUs: parseInt(__ENV.VU || '50', 10) * 2,
      stages: [
        { duration: __ENV.RAMP_UP || '30s', target: 50 },
        { duration: __ENV.DURATION || '5m', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '2m', target: 100 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],
    webhook_success_rate: ['rate>0.99'],
    webhook_duration_ms: ['p(95)<2000'],
  },
  tags: {
    test: 'stas-webhook-load',
    component: 'webhook',
  },
};

// ── Setup ────────────────────────────────────────────────────────────────────

export function setup() {
  console.log(`Starting webhook load test against ${TARGET_URL}`);
  console.log(`Virtual users: ${options.scenarios.webhook_load.preAllocatedVUs}`);
  console.log(`Duration: ${__ENV.DURATION || '5m'}`);

  // Quick health check
  const healthResp = http.get(TARGET_URL.replace('/webhook', '/health'));
  check(healthResp, {
    'health endpoint is reachable': (r) => r.status === 200,
  });

  return {
    startTime: new Date().toISOString(),
    targetUrl: TARGET_URL,
  };
}

// ── Main test function ───────────────────────────────────────────────────────

export default function (data) {
  const eventType = ISSUE_EVENTS[Math.floor(Math.random() * ISSUE_EVENTS.length)];
  const payload = generatePayload(eventType);
  const deliveryId = `load-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-GitHub-Event': eventType,
    'X-GitHub-Delivery': deliveryId,
    'X-Hub-Signature-256': `sha256=${WEBHOOK_SECRET}`,
    'User-Agent': 'k6-load-test',
  };

  group(`POST /webhook (${eventType})`, () => {
    const startTime = Date.now();
    const response = http.post(TARGET_URL, JSON.stringify(payload), { headers });
    const duration = Date.now() - startTime;

    webhookDuration.add(duration);
    webhookTotal.add(1);

    const passed = check(response, {
      'status is 202 (accepted)': (r) => r.status === 202,
      'response has accepted: true': (r) => {
        try {
          return JSON.parse(r.body).accepted === true;
        } catch {
          return false;
        }
      },
      'response time < 5000ms': () => duration < 5000,
    });

    if (passed) {
      webhookSuccessRate.add(true);
    } else {
      webhookSuccessRate.add(false);
      webhookFailures.add(1);
      console.warn(`Webhook failed: status=${response.status}, duration=${duration}ms, delivery=${deliveryId}`);
    }
  });

  // Simulate think time between webhooks (10-50ms)
  sleep(Math.random() * 0.04 + 0.01);
}

// ── Teardown ─────────────────────────────────────────────────────────────────

export function teardown(data) {
  console.log(`Webhook load test completed. Started at: ${data.startTime}`);
  console.log('Results are available in the k6 output above.');
}
