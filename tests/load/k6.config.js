/**
 * k6 Shared Configuration
 *
 * Default options used by all load test scripts.
 * Individual test scripts can override these per-test.
 *
 * Usage:
 *   k6 run --config tests/load/k6.config.js tests/load/webhook-load-test.js
 *
 * Environment variables:
 *   TARGET_URL        — Base URL of the STAS instance under test
 *   K6_OUT            — Output destination (e.g., influxdb, json, cloud)
 *   K6_PROMETHEUS_RW_SERVER_URL — Prometheus remote write URL
 */

export const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

// Shared thresholds enforced across all load tests (unless overridden)
export const SHARED_THRESHOLDS = {
  http_req_duration: ['p(95)<5000', 'p(99)<10000'],
  http_req_failed: ['rate<0.05'],
};

/**
 * Default options applied to every test. Individual test files
 * spread this into their own `options` export and can override freely.
 */
export const baseOptions = {
  // System under test base URL
  hosts: { [BASE_URL]: BASE_URL },

  // Default HTTP settings
  http: {
    timeout: '30s',
  },

  // Don't discard response bodies — we need them for checks
  discardResponseBodies: false,

  // Summarize p(50), p(90), p(95), p(99) by default
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p50', 'p90', 'p95', 'p99', 'count'],

  // Shared thresholds
  thresholds: { ...SHARED_THRESHOLDS },

  // Tag all requests with the test suite name
  tags: {
    suite: 'stas-load-test',
  },

  // Graceful stop on threshold failure
  noVUConnectionReuse: true,
};
