import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const STAS_URL = process.env.STAS_URL || "http://localhost:4095";
const GOVERNANCE_URL = process.env.GOVERNANCE_URL || "http://localhost:4003";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "test-secret";
const ADMIN_KEY = process.env.GOVERNANCE_ADMIN_KEY || "test-admin-key";

function sign(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const TEST_ISSUE_PAYLOAD = {
  action: "labeled",
  issue: {
    number: 9999,
    title: "Integration test: null check bug",
    body: "Reproduction: call getValue() on null reference. Expected: graceful null check.",
    labels: [{ name: "stas:fix" }],
  },
  repository: { owner: { login: "aimino" }, name: "stas-demo-private" },
  installation: { id: 99999 },
};

describe("STAS ↔ Governance integration stack", () => {
  beforeAll(async () => {
    const stasHealth = await fetch(`${STAS_URL}/health`);
    expect(stasHealth.status).toBe(200);
    const governanceHealth = await fetch(`${GOVERNANCE_URL}/guardrail/health`);
    expect(governanceHealth.status).toBe(200);
  });

  afterAll(async () => {
    await fetch(`${GOVERNANCE_URL}/admin/resume/test-tenant`, {
      method: "POST",
      headers: { "X-Admin-Key": ADMIN_KEY },
    }).catch(() => undefined);
  });

  it("accepts a validly-signed webhook with 202 {accepted:true}", async () => {
    const rawBody = JSON.stringify(TEST_ISSUE_PAYLOAD);
    const resp = await postJson(`${STAS_URL}/webhook/github`, rawBody, {
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": `test-delivery-${Date.now()}`,
      "X-Hub-Signature-256": sign(rawBody, WEBHOOK_SECRET),
    });
    expect(resp.status).toBe(202);
    await expect(resp.json()).resolves.toEqual({ accepted: true });
  });

  it("rejects a webhook with an invalid signature (401)", async () => {
    const rawBody = JSON.stringify(TEST_ISSUE_PAYLOAD);
    const resp = await postJson(`${STAS_URL}/webhook/github`, rawBody, {
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": `test-delivery-${Date.now()}`,
      "X-Hub-Signature-256": "sha256=wrong",
    });
    expect(resp.status).toBe(401);
    await expect(resp.json()).resolves.toEqual({ error: "Invalid signature" });
  });

  it("rejects a webhook with no signature (401)", async () => {
    const resp = await postJson(`${STAS_URL}/webhook/github`, TEST_ISSUE_PAYLOAD, {
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": `test-delivery-${Date.now()}`,
    });
    expect(resp.status).toBe(401);
    await expect(resp.json()).resolves.toEqual({ error: "Signature required" });
  });

  it("kills a tenant via the governance proxy and blocks its webhooks (402)", async () => {
    const killResp = await fetch(`${GOVERNANCE_URL}/admin/kill/test-tenant`, {
      method: "POST",
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(killResp.status).toBe(200);
    const killBody = await killResp.json();
    expect(killBody.status).toBe("ok");
    expect(killBody.tenant_id).toBe("test-tenant");

    const blocked = await postJson(`${GOVERNANCE_URL}/api/stas/webhook`, {
      tenant_id: "test-tenant",
      issue_id: "test/foo#1",
    });
    expect(blocked.status).toBe(402);
    const blockedBody = await blocked.json();
    expect(blockedBody.error?.type).toBe("kill_switch");
  });

  it("forwards an allowed webhook to the OpenSymphony upstream (502 when unreachable)", async () => {
    const resp = await postJson(`${GOVERNANCE_URL}/api/stas/webhook`, {
      tenant_id: "default",
      issue_id: "test/bar#2",
    });
    // The integration stack does not deploy an OpenSymphony service, so the
    // governance proxy fails to reach the upstream and reports a 502.
    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body.status).toBe("error");
    expect(body.error).toContain("Upstream unreachable");
  });
});
