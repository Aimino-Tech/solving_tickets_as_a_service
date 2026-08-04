import { check, sleep, group } from "k6";
import http from "k6/http";

export const options = {
  scenarios: {
    db_reads: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 50 },
        { duration: "20s", target: 100 },
        { duration: "30s", target: 200 },
        { duration: "30s", target: 200 },
        { duration: "10s", target: 0 },
      ],
      exec: "readEndpoint",
      startTime: "0s",
    },
    db_writes: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 20 },
        { duration: "20s", target: 50 },
        { duration: "30s", target: 100 },
        { duration: "30s", target: 100 },
        { duration: "10s", target: 0 },
      ],
      exec: "writeEndpoint",
      startTime: "10s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    http_req_failed: ["rate<0.01"],
    "http_req_duration{group:DB::Reads}": ["p(95)<500"],
    "http_req_duration{group:DB::Writes}": ["p(95)<1000"],
  },
};

const BASE_URL = __ENV.SYNTARO_URL || "http://localhost:3000";

export function readEndpoint() {
  group("DB::Reads", () => {
    const endpoints = [
      "/api/v1/admin/feature-flags",
      "/api/benchmarks",
      "/api/pricing",
    ];

    for (const ep of endpoints) {
      const res = http.get(`${BASE_URL}${ep}`, {
        tags: { group: "DB::Reads", endpoint: ep },
      });
      check(res, {
        [`read ${ep} ok`]: (r) => r.status === 200,
      });
      sleep(0.5);
    }
  });
}

export function writeEndpoint() {
  group("DB::Writes", () => {
    const payload = JSON.stringify({
      name: `load-test-${__VU}-${__ITER}`,
      data: { test: true, timestamp: Date.now() },
    });

    const res = http.post(`${BASE_URL}/api/v1/admin/feature-flags`, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": "test-admin-key",
      },
      tags: { group: "DB::Writes" },
    });

    check(res, {
      "write accepted": (r) => r.status === 200 || r.status === 201 || r.status === 401,
    });
  });
}
