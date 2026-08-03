import { check, sleep } from "k6";
import http from "k6/http";
import { randomRepo, generateWebhookPayload } from "../lib/helpers.js";

export const options = {
  scenarios: {
    webhook_flood: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 100 },
        { duration: "30s", target: 200 },
        { duration: "1m", target: 200 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.SYNTARO_URL || "http://localhost:3000";

export default function () {
  const [owner, name] = randomRepo(__VU).split("/");
  const payload = generateWebhookPayload(owner, name, __ITER + 1);
  const res = http.post(`${BASE_URL}/webhook`, payload, {
    headers: { "Content-Type": "application/json", "X-GitHub-Event": "issues.labeled", "X-GitHub-Delivery": `d-${__VU}-${__ITER}` },
  });
  check(res, { "accepted": (r) => r.status === 202, "fast": (r) => r.timings.duration < 500 });
  sleep(Math.random() * 0.5 + 0.1);
}
