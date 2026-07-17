import { check } from "k6";
import http from "k6/http";
import { randomRepo, generateWebhookPayload } from "../lib/helpers.js";

export const options = {
  scenarios: {
    sustained_load: {
      executor: "constant-arrival-rate",
      rate: 100, timeUnit: "1s", duration: "3m",
      preAllocatedVUs: 50, maxVUs: 200,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    http_req_failed: ["rate<0.02"],
  },
};

const BASE_URL = __ENV.STAS_URL || "http://localhost:3000";

export default function () {
  const [owner, name] = randomRepo(__VU).split("/");
  const payload = generateWebhookPayload(owner, name, __ITER + 1);
  const res = http.post(`${BASE_URL}/webhook`, payload, {
    headers: { "Content-Type": "application/json", "X-GitHub-Event": "issues.labeled", "X-GitHub-Delivery": `q-${__VU}-${__ITER}` },
  });
  check(res, { "accepted": (r) => r.status === 202, "not limited": (r) => r.status !== 429 });
}
