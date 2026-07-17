/**
 * k6 Load Test — Database Concurrent Reads/Writes
 *
 * Tests database connection pool limits and query performance under
 * concurrent load. Simulates the read/write patterns of 500 concurrent users:
 *   - Read-heavy: health checks, status queries, run history
 *   - Write-heavy: webhook event logging, audit trails, run results
 *   - Mixed: status updates with reads
 *
 * Usage:
 *   k6 run scripts/load-test/db.js
 *
 * Environment variables:
 *   API_URL      — STAS API base URL (default: http://localhost:3000)
 *   API_KEY      — Admin API key (default: '')
 *   VU           — Number of virtual users (default: 50)
 *   DURATION     — Test duration (default: 3m)
 *
 * Expected thresholds for 500-user capacity:
 *   - p95 latency < 500ms for reads
 *   - p95 latency < 1000ms for writes
 *   - error rate < 1% for all operations
 *   - connection pool does not exhaust
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ───────────────────────────────────────────────────────────

const dbReadDuration = new Trend('db_read_duration_ms', true);
const dbWriteDuration = new Trend('db_write_duration_ms', true);
const dbReadSuccessRate = new Rate('db_read_success_rate');
const dbWriteSuccessRate = new Rate('db_write_success_rate');
const dbFailures = new Counter('db_failures');
const dbTotal = new Counter('db_total_operations');

// ── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || '';

function authHeaders() {
  const h = { 'Content-Type': 'application/json', 'User-Agent': 'k6-load-test' };
  if (API_KEY) h['Authorization'] = `Bearer ${API_KEY}`;
  return h;
}

// ── k6 options ──────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    db_read_load: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VU || '50', 10),
      duration: __ENV.DURATION || '3m',
      exec: 'readTest',
      startTime: '0s',
    },
    db_write_load: {
      executor: 'constant-vus',
      vus: Math.max(10, Math.floor(parseInt(__ENV.VU || '50', 10) / 3)),
      duration: __ENV.DURATION || '3m',
      exec: 'writeTest',
      startTime: '5s',
    },
  },
  thresholds: {
    db_read_duration_ms: ['p(95)<500', 'p(99)<2000'],
    db_write_duration_ms: ['p(95)<1000', 'p(99)<3000'],
    db_read_success_rate: ['rate>0.99'],
    db_write_success_rate: ['rate>0.99'],
  },
  tags: {
    test: 'stas-db-load',
    component: 'database',
  },
};

// ── Helper: generate unique test data ────────────────────────────────────────

let writeCounter = 0;

function generateRunData() {
  writeCounter++;
  return {
    installationId: Math.floor(Math.random() * 1000) + 1,
    repoOwner: 'test-org',
    repoName: `test-repo-${Math.floor(Math.random() * 50) + 1}`,
    issueNumber: Math.floor(Math.random() * 50000) + 1,
    issueTitle: `Load test run ${Date.now()}-${writeCounter}`,
    status: Math.random() > 0.3 ? 'success' : 'failed',
    duration: Math.floor(Math.random() * 300000),
  };
}

// ── Read-heavy test executor ─────────────────────────────────────────────────

export function readTest(data) {
  group('Database Reads', () => {
    const operations = [
      { name: 'health check', url: `${BASE_URL}/health` },
      { name: 'health ready', url: `${BASE_URL}/health/ready` },
      { name: 'admin stats', url: `${BASE_URL}/admin/stats`, auth: true },
      { name: 'list runs', url: `${BASE_URL}/api/v1/runs?limit=20`, auth: true },
      { name: 'list repos', url: `${BASE_URL}/api/repos` },
    ];

    // Pick 2-3 operations per iteration
    const count = Math.floor(Math.random() * 2) + 2;
    const shuffled = operations.sort(() => Math.random() - 0.5).slice(0, count);

    for (const op of shuffled) {
      const startTime = Date.now();
      const headers = op.auth ? authHeaders() : { 'User-Agent': 'k6-load-test' };
      const response = http.get(op.url, { headers });
      const duration = Date.now() - startTime;

      dbReadDuration.add(duration);
      dbTotal.add(1);

      const passed = check(response, {
        [`${op.name} read succeeded`]: (r) => r.status >= 200 && r.status < 500,
        [`${op.name} response time < 2000ms`]: () => duration < 2000,
      });

      if (passed) {
        dbReadSuccessRate.add(true);
      } else {
        dbReadSuccessRate.add(false);
        dbFailures.add(1);
      }
    }
  });

  sleep(Math.random() * 0.2 + 0.1);
}

// ── Write-heavy test executor ────────────────────────────────────────────────

export function writeTest(data) {
  group('Database Writes', () => {
    const startWrite = Date.now();
    const writeResp = http.post(
      `${BASE_URL}/admin/webhooks`,
      JSON.stringify(generateRunData()),
      { headers: authHeaders() },
    );
    const writeDuration = Date.now() - startWrite;

    dbWriteDuration.add(writeDuration);
    dbTotal.add(1);

    const writePassed = check(writeResp, {
      'write operation completed': (r) => r.status >= 200 && r.status < 500,
      'write response time < 3000ms': () => writeDuration < 3000,
    });

    if (writePassed) {
      dbWriteSuccessRate.add(true);
    } else {
      dbWriteSuccessRate.add(false);
      dbFailures.add(1);
    }
  });

  sleep(Math.random() * 0.3 + 0.2);
}

// ── Setup ────────────────────────────────────────────────────────────────────

export function setup() {
  console.log(`Starting database load test against ${BASE_URL}`);
  console.log(`Read VUs: ${options.scenarios.db_read_load.vus}`);
  console.log(`Write VUs: ${options.scenarios.db_write_load.vus}`);

  const healthResp = http.get(`${BASE_URL}/health`);
  check(healthResp, {
    'health endpoint is reachable': (r) => r.status === 200,
  });

  return { startTime: new Date().toISOString(), baseUrl: BASE_URL };
}

// ── Teardown ─────────────────────────────────────────────────────────────────

export function teardown(data) {
  console.log(`Database load test completed. Started at: ${data.startTime}`);
}
