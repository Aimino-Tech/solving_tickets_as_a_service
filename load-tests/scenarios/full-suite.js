import { check, sleep } from "k6";
import http from "k6/http";
import { randomRepo, generateWebhookPayload } from "../lib/helpers.js";

export const options = {
  scenarios: {
    health: { executor: "constant-vus", vus: 50, duration: "1m", exec: "healthCheck", startTime: "0s" },
    webhooks: {
      executor: "ramping-vus", startVUs: 0,
      stages: [
        { duration: "30s", target: 100 },
        { duration: "1m", target: 300 },
        { duration: "30s", target: 500 },
        { duration: "2m", target: 500 },
        { duration: "30s", target: 0 },
      ],
      exec: "sendWebhook", startTime: "10s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    "http_req_duration{scenario:webhooks}": ["p(95)<500"],
  },
};

const BASE_URL = __ENV.STAS_URL || "http://localhost:3000";

export function healthCheck() {
  check(http.get(`${BASE_URL}/health`), { "ok": (r) => r.status === 200 });
  sleep(1);
}

export function sendWebhook() {
  const [owner, name] = randomRepo(__VU).split("/");
  const payload = generateWebhookPayload(owner, name, __ITER + 1);
  const res = http.post(`${BASE_URL}/webhook`, payload, {
    headers: { "Content-Type": "application/json", "X-GitHub-Event": "issues.labeled", "X-GitHub-Delivery": `f-${__VU}-${__ITER}` },
  });
  check(res, { "accepted": (r) => r.status === 202, "fast": (r) => r.timings.duration < 500 });
  sleep(Math.random() * 0.3 + 0.1);
}
