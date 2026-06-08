/**
 * Load Test: Webhook Endpoint Throughput
 *
 * Measures max webhooks/sec a single STAS API instance can handle.
 * Sends realistic GitHub webhook payloads to POST /webhook.
 *
 * Stages:
 *   1. Ramp up — 5s to 10 VUs (warm connections, rate limiter)
 *   2. Sustained — 30s at 50 VUs (steady-state throughput)
 *   3. Peak — 20s at 100 VUs (burst handling)
 *   4. Stress — 15s at 200 VUs (saturation point)
 *   5. Cooldown — 10s to 0 VUs (graceful drain)
 *
 * Metrics captured:
 *   - http_req_duration (p50, p90, p99)
 *   - http_reqs (throughput per second)
 *   - http_req_failed (error rate)
 *   - Custom: webhook_accepted, webhook_rejected, rate_limited
 *
 * Usage:
 *   DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=true k6 run tests/load/webhook-load-test.js
 *
 * Environment:
 *   TARGET_URL  — base URL (default: http://localhost:3000)
 *   RAMP_VUS    — ramp-up VUs (default: 10)
 *   SUSTAIN_VUS — sustained VUs (default: 50)
 *   SUSTAIN_DUR — sustained duration (default: 30s)
 *   PEAK_VUS    — peak VUs (default: 100)
 *   STRESS_VUS  — stress VUs (default: 200)
 *   DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY — set "true" to skip HMAC verification
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { BASE_URL, baseOptions } from './k6.config.js';

// ── Custom Metrics ─────────────────────────────────────────────────────────

const webhookAccepted = new Counter('webhook_accepted');
const webhookRejected = new Counter('webhook_rejected');
const rateLimited = new Counter('rate_limited');
const webhookLatency = new Trend('webhook_latency_ms');

// ── Configuration ─────────────────────────────────────────────────────────
//
// Webhook signature verification
// ──────────────────────────────
// STAS verifies X-Hub-Signature-256 by default. Load tests send random
// payloads, so the signature will never match. To bypass, either:
//
//   (a) Set DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=true when running k6:
//         DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=true k6 run tests/load/webhook-load-test.js
//
//   (b) Or omit the X-Hub-Signature-256 header entirely (the server also
//       skips verification when no signature header is present).
//
// We use approach (b) here — no signature header is sent — so the tests
// work out of the box without env var configuration.

const TARGET = __ENV.TARGET_URL || BASE_URL;
const WEBHOOK_URL = `${TARGET}/webhook`;

// ── Options ───────────────────────────────────────────────────────────────

export const options = {
  ...baseOptions,
  stages: [
    { duration: '5s', target: parseInt(__ENV.RAMP_VUS || '10') },
    { duration: __ENV.SUSTAIN_DUR || '30s', target: parseInt(__ENV.SUSTAIN_VUS || '50') },
    { duration: '20s', target: parseInt(__ENV.PEAK_VUS || '100') },
    { duration: '15s', target: parseInt(__ENV.STRESS_VUS || '200') },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    ...baseOptions.thresholds,
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
    webhook_accepted: ['count>0'],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function generateWebhookPayload(size) {
  const sizes = {
    small: { titleLen: 20, bodyLen: 100 },
    medium: { titleLen: 80, bodyLen: 500 },
    large: { titleLen: 200, bodyLen: 2000 },
  };
  const s = sizes[size] || sizes.medium;

  return JSON.stringify({
    action: 'labeled',
    issue: {
      number: Math.floor(Math.random() * 10000) + 1,
      title: 'X'.repeat(s.titleLen),
      body: 'X'.repeat(s.bodyLen),
      labels: [{ name: 'stas:fix' }],
      state: 'open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    repository: {
      id: Math.floor(Math.random() * 1000000),
      name: 'test-repo-' + Math.floor(Math.random() * 100),
      full_name: 'owner/test-repo-' + Math.floor(Math.random() * 100),
      private: Math.random() > 0.5,
      owner: { login: 'owner', id: Math.floor(Math.random() * 10000) },
    },
    installation: { id: Math.floor(Math.random() * 1000) + 100 },
    sender: { login: 'test-user', id: Math.floor(Math.random() * 10000) },
  });
}

// ── Main Test ──────────────────────────────────────────────────────────────

export default function () {
  group('Webhook Ingestion', () => {
    const payload = generateWebhookPayload();

    const headers = {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'issues.labeled',
      'X-GitHub-Delivery': 'delivery-' + Math.random().toString(36).substring(2, 15),
      // NOTE: X-Hub-Signature-256 intentionally omitted.
      // The server skips verification when no signature header is present.
      // See comment at top of file for details.
      'X-Request-Id': 'load-test-' + Math.random().toString(36).substring(2, 15),
    };

    const start = Date.now();
    const response = http.post(WEBHOOK_URL, payload, { headers });
    const latency = Date.now() - start;

    webhookLatency.add(latency);

    if (response.status === 202) {
      webhookAccepted.add(1);
      check(response, {
        'accepted (202)': (r) => r.status === 202,
        'body has accepted:true': (r) => {
          try {
            return JSON.parse(r.body).accepted === true;
          } catch {
            return false;
          }
        },
      });
    } else if (response.status === 429) {
      rateLimited.add(1);
      check(response, {
        'rate limited (429)': (r) => r.status === 429,
      });
    } else {
      webhookRejected.add(1);
      check(response, {
        'unexpected status': (r) => r.status < 500,
      });
    }
  });

  sleep(0.1);
}

export function teardown() {
  console.log('--- Webhook Load Test Complete ---');
}
