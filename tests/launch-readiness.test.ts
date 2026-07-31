import { execSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

const REQUIRED_ENV = {
  GITHUB_WEBHOOK_SECRET: "test-secret",
  GITHUB_APP_ID: "test-app-id",
};

interface ExpressLayer {
  name?: string;
  regexp?: RegExp;
  route?: { path?: string };
}

function appStack(app: unknown): ExpressLayer[] {
  return ((app as { _router?: { stack?: ExpressLayer[] } })._router?.stack) ?? [];
}

function isScopedRouterMount(app: unknown, mountPath: string): boolean {
  return appStack(app).some((layer) => {
    if (layer.name !== "router" || !layer.regexp) return false;
    if (layer.regexp.test("/launch-readiness-negative-probe")) return false;
    return layer.regexp.test(`${mountPath}/probe`);
  });
}

describe("launch readiness", () => {
  it("builds the project with exit code 0", () => {
    expect(() =>
      execSync("npm run build", {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
        timeout: 170_000,
      }),
    ).not.toThrow();
  });

  it("mounts the key webhook and API routes", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { createApp } = await import("../src/server");
    const app = await createApp();

    const routePaths = appStack(app)
      .map((layer) => layer.route?.path)
      .filter((p): p is string => typeof p === "string");
    expect(routePaths).toContain("/webhook");
    expect(routePaths).toContain("/webhook/github");
    expect(routePaths).toContain("/webhook/stripe");

    for (const mount of [
      "/admin",
      "/api/v1/admin",
      "/api/admin/audit",
      "/api/v1/me",
      "/api/v1/config",
      "/api/v1/auth",
      "/admin/webhooks",
      "/api/v1/onboarding",
      "/api/v1/notifications",
      "/api/teams",
      "/api/repos",
      "/api/runs",
    ]) {
      expect(isScopedRouterMount(app, mount)).toBe(true);
    }

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const health = await fetch(`${base}/health`);
      expect([200, 503]).toContain(health.status);

      const webhook = await fetch(`${base}/webhook/github`, { method: "POST" });
      expect(webhook.status).toBe(401);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("exposes the expected config defaults", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await import("../src/config");
    expect(config.port).toBe(3000);
    expect(config.queue.redisUrl).toBe("redis://localhost:6379");
    expect(config.runMode).toBe("both");
  });
});
