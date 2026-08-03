import { check, sleep } from "k6";
import http from "k6/http";

export const options = {
  scenarios: {
    api_benchmark: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 50 },
        { duration: "20s", target: 100 },
        { duration: "30s", target: 200 },
        { duration: "30s", target: 200 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<200"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.SYNTARO_URL || "http://localhost:3000";

export default function () {
  const res = http.get(`${BASE_URL}/health`);
  check(res, { "health ok": (r) => r.status === 200 });
  sleep(1);
}
