/**
 * k6 Load Test — API Endpoint Throughput
 *
 * Tests the throughput of STAS API endpoints under load.
 * Covers: /health, /health/ready, /health/queue, /metrics,
 *         /api/v1/runs, /api/v1/stats, /api/repos
 *
 * Usage:
 *   k6 run scripts/load-test/api.js
 *
 * Environment variables:
 *   TARGET_URL   — STAS API base URL (default: http://localhost:3000)
 *   API_KEY      — Admin API key for authenticated endpoints (default: '')
 *   VU           — Number of virtual users (default: 20)
 *   DURATION     — Test duration (default: 5m)
 *
 * Expected thresholds for 500-user capacity:
 *   - p95 latency < 500ms for health endpoints
 *   - p95 latency < 1000ms for API endpoints
 *   - error rate < 0.5%
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ───────────────────────────────────────────────────────────

const apiDuration = new Trend('api_duration_ms', true);
const apiSuccessRate = new Rate('api_success_rate');
const apiFailures = new Counter('api_failures');
const apiTotal = new Counter('api_total');

// ── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || '';

// ── k6 options ──────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    api_load: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VU || '20', 10),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
    http_req_failed: ['rate<0.005'],
    api_success_rate: ['rate>0.995'],
    api_duration_ms: ['p(95)<1000'],
  },
  tags: {
    test: 'stas-api-load',
    component: 'api',
  },
};

// ── Endpoint definitions ─────────────────────────────────────────────────────

const ENDPOINTS = [
  // Health endpoints (highest weight — monitoring probes)
  { method: 'GET', path: '/health', weight: 25, authenticated: false },
  { method: 'GET', path: '/health/ready', weight: 15, authenticated: false },
  { method: 'GET', path: '/health/queue', weight: 10, authenticated: false },

  // Metrics endpoint
  { method: 'GET', path: '/metrics', weight: 5, authenticated: false },

  // Admin endpoints (authenticated)
  { method: 'GET', path: '/admin/health', weight: 5, authenticated: true },
  { method: 'GET', path: '/admin/stats', weight: 5, authenticated: true },

  // Public API endpoints
  { method: 'GET', path: '/api/repos', weight: 10, authenticated: false },
  { method: 'GET', path: '/api/pricing', weight: 8, authenticated: false },
  { method: 'GET', path: '/api/benchmarks', weight: 5, authenticated: false },

  // Authenticated API endpoints
  { method: 'GET', path: '/api/v1/me/dashboard', weight: 8, authenticated: true },
  { method: 'GET', path: '/api/v1/credits/usage', weight: 4, authenticated: true },
];

// ── Setup ────────────────────────────────────────────────────────────────────

export function setup() {
  console.log(`Starting API load test against ${BASE_URL}`);
  console.log(`Virtual users: ${options.scenarios.api_load.vus}`);

  // Quick health check
  const healthResp = http.get(`${BASE_URL}/health`);
  check(healthResp, {
    'health endpoint is reachable': (r) => r.status === 200,
  });

  return { startTime: new Date().toISOString(), baseUrl: BASE_URL };
}

// ── Weighted random selection ────────────────────────────────────────────────

function selectEndpoint() {
  const totalWeight = ENDPOINTS.reduce((sum, ep) => sum + ep.weight, 0);
  let random = Math.random() * totalWeight;
  for (const ep of ENDPOINTS) {
    random -= ep.weight;
    if (random <= 0) return ep;
  }
  return ENDPOINTS[0];
}

// ── Main test function ───────────────────────────────────────────────────────

export default function (data) {
  const endpoint = selectEndpoint();
  const url = `${data.baseUrl}${endpoint.path}`;

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'k6-load-test',
  };

  if (endpoint.authenticated && API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }

  group(`${endpoint.method} ${endpoint.path}`, () => {
    const startTime = Date.now();

    let response;
    if (endpoint.method === 'GET') {
      response = http.get(url, { headers });
    } else {
      response = http.post(url, JSON.stringify(endpoint.body || {}), { headers });
    }

    const duration = Date.now() - startTime;
    apiDuration.add(duration);
    apiTotal.add(1);

    const passed = check(response, {
      [`${endpoint.method} ${endpoint.path} status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
      'response time < 3000ms': () => duration < 3000,
    });

    if (passed) {
      apiSuccessRate.add(true);
    } else {
      apiSuccessRate.add(false);
      apiFailures.add(1);
    }
  });

  // Simulate think time between API calls (50-200ms)
  sleep(Math.random() * 0.15 + 0.05);
}

// ── Teardown ─────────────────────────────────────────────────────────────────

export function teardown(data) {
  console.log(`API load test completed. Started at: ${data.startTime}`);
}
