import { check, sleep, group } from "k6";
import http from "k6/http";

export const options = {
  scenarios: {
    redis_reads: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 50 },
        { duration: "20s", target: 100 },
        { duration: "30s", target: 300 },
        { duration: "30s", target: 300 },
        { duration: "10s", target: 0 },
      ],
      exec: "cacheRead",
      startTime: "0s",
    },
    redis_writes: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 30 },
        { duration: "20s", target: 80 },
        { duration: "30s", target: 150 },
        { duration: "30s", target: 150 },
        { duration: "10s", target: 0 },
      ],
      exec: "cacheWrite",
      startTime: "5s",
    },
  },
  thresholds: {
    "http_req_duration{group:Cache::Reads}": ["p(95)<200"],
    "http_req_duration{group:Cache::Writes}": ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.STAS_URL || "http://localhost:3000";

export function cacheRead() {
  group("Cache::Reads", () => {
    const endpoints = [
      "/api/benchmarks",
      "/api/pricing",
      "/health",
      "/discovery",
    ];

    for (const ep of endpoints) {
      const res = http.get(`${BASE_URL}${ep}`, {
        tags: { group: "Cache::Reads", endpoint: ep },
      });
      check(res, {
        [`cache read ${ep} ok`]: (r) => r.status === 200,
        [`cache read ${ep} fast`]: (r) => r.timings.duration < 200,
      });
      sleep(Math.random() * 0.2 + 0.1);
    }
  });
}

export function cacheWrite() {
  group("Cache::Writes", () => {
    for (let i = 0; i < 5; i++) {
      const sessionPayload = JSON.stringify({
        session: `test-session-${__VU}-${__ITER}-${i}`,
        data: { userId: __VU, timestamp: Date.now() },
      });

      const res = http.post(`${BASE_URL}/api/v1/me/`, sessionPayload, {
        headers: {
          "Content-Type": "application/json",
          "x-account-id": `org-${__VU % 500}`,
        },
        tags: { group: "Cache::Writes" },
      });
      check(res, {
        "cache write ok": (r) => r.status === 200 || r.status === 400 || r.status === 401,
      });
    }
  });
}
