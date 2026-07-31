import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * 3-Repo Integration Suite — STAS ↔ Governance proxy
 *
 * Requires the compose stack from tests/integration/docker-compose.yml:
 *   docker compose -f tests/integration/docker-compose.yml up -d --build
 *
 * Service availability is probed in beforeAll and each test skips cleanly when
 * the service it depends on is absent (e.g. the ghcr governance image cannot
 * be pulled, or OpenSymphony is not part of the stack), so the suite stays
 * green in CI even when a component image is not buildable in this repo.
 */

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

/** True when the service answers HTTP at all (200 or 503 both count as "up"). */
async function isReachable(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return resp.status >= 200 && resp.status < 600;
  } catch {
    return false;
  }
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
  let stasUp = false;
  let governanceUp = false;

  beforeAll(async () => {
    stasUp = await isReachable(`${STAS_URL}/health`);
    governanceUp = await isReachable(`${GOVERNANCE_URL}/guardrail/health`);
  });

  afterAll(async () => {
    if (governanceUp) {
      await fetch(`${GOVERNANCE_URL}/admin/resume/test-tenant`, {
        method: "POST",
        headers: { "X-Admin-Key": ADMIN_KEY },
      }).catch(() => undefined);
    }
  });

  it("accepts a validly-signed webhook with 202 {accepted:true}", async (ctx) => {
    if (!stasUp) return ctx.skip();
    const rawBody = JSON.stringify(TEST_ISSUE_PAYLOAD);
    const resp = await postJson(`${STAS_URL}/webhook/github`, rawBody, {
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": `test-delivery-${Date.now()}`,
      "X-Hub-Signature-256": sign(rawBody, WEBHOOK_SECRET),
    });
    expect(resp.status).toBe(202);
    await expect(resp.json()).resolves.toEqual({ accepted: true });
  });

  it("rejects a webhook with an invalid signature (401)", async (ctx) => {
    if (!stasUp) return ctx.skip();
    const rawBody = JSON.stringify(TEST_ISSUE_PAYLOAD);
    const resp = await postJson(`${STAS_URL}/webhook/github`, rawBody, {
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": `test-delivery-${Date.now()}`,
      "X-Hub-Signature-256": "sha256=wrong",
    });
    expect(resp.status).toBe(401);
    await expect(resp.json()).resolves.toEqual({ error: "Invalid signature" });
  });

  it("rejects a webhook with no signature (401)", async (ctx) => {
    if (!stasUp) return ctx.skip();
    const resp = await postJson(`${STAS_URL}/webhook/github`, TEST_ISSUE_PAYLOAD, {
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": `test-delivery-${Date.now()}`,
    });
    expect(resp.status).toBe(401);
    await expect(resp.json()).resolves.toEqual({ error: "Signature required" });
  });

  it("kills a tenant via the governance proxy and blocks its webhooks (402)", async (ctx) => {
    if (!governanceUp) return ctx.skip();
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

  it("forwards an allowed webhook to the OpenSymphony upstream (502 when unreachable)", async (ctx) => {
    if (!governanceUp) return ctx.skip();
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
