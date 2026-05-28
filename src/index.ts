/**
 * STAS — Solving Tickets As A Service
 *
 * A GitHub bot that turns labeled issues into PRs via OpenCode.
 *
 * Usage:
 *   1. Run `opencode serve` on :4096
 *   2. Set up env vars (see .env.example)
 *   3. `bun run src/index.ts`
 *   4. Install the GitHub App on a repo
 *   5. Label an issue with `stas:fix`
 *   6. Get a PR
 */

import Fastify from "fastify";
import { config, requireConfig } from "./config.js";
import { handleIssueLabeled, type IssueLabeledPayload } from "./webhook.js";

requireConfig();

const app = Fastify({ logger: true });

// Health check
app.get("/health", async () => ({ status: "ok", label: config.label }));

// GitHub webhook receiver
app.post("/webhook/github", async (req, reply) => {
  const event = req.headers["x-github-event"] as string | undefined;
  const delivery = req.headers["x-github-delivery"] as string | undefined;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const body = req.body as Record<string, unknown>;

  // Verify webhook signature
  if (signature) {
    const sigAlgo = { name: "HMAC", hash: "SHA-256" };
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(config.github.webhookSecret),
      sigAlgo,
      false,
      ["verify"],
    );
    const expected = "sha256=" + Array.from(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(JSON.stringify(body)),
        ),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");

    if (signature !== expected) {
      reply.status(401).send({ error: "Invalid signature" });
      return;
    }
  }

  console.log(`[webhook] event=${event} delivery=${delivery}`);

  // We only handle labeled issues for now
  if (event === "issues" && (body.action as string) === "labeled") {
    // Fire and forget — respond 200 immediately
    handleIssueLabeled(body as unknown as IssueLabeledPayload).catch((err) =>
      console.error("Handler error:", err),
    );
  }

  reply.status(200).send({ ok: true });
});

// Start
app.listen({ port: config.port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`STAS bot listening on ${address}`);
  console.log(`Trigger label: ${config.label}`);
  console.log(`OpenCode endpoint: ${config.opencode.url}`);
});
