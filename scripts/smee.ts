#!/usr/bin/env tsx
/**
 * smee.ts — Smee client for forwarding GitHub webhooks to localhost.
 *
 * Usage:
 *   tsx scripts/smee.ts
 *   tsx scripts/smee.ts --url https://smee.io/my-channel --target http://localhost:3000/webhook
 *
 * Environment variables:
 *   SMEE_URL  — smee.io channel URL (default: https://smee.io/stas-dev)
 *   STAS_URL  — local webhook target (default: http://localhost:3000/webhook)
 */

import process from "node:process";
import SmeeClient from "smee-client";
import "dotenv/config";

const SMEE_DEFAULT = "https://smee.io/stas-dev";
const STAS_DEFAULT = "http://localhost:3000/webhook";

function parseArgs(): { source: string; target: string } {
  const args = process.argv.slice(2);
  let source = process.env.SMEE_URL ?? SMEE_DEFAULT;
  let target = process.env.STAS_URL ?? STAS_DEFAULT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      source = args[++i];
    } else if (args[i] === "--target" && args[i + 1]) {
      target = args[++i];
    }
  }

  return { source, target };
}

async function main(): Promise<void> {
  const { source, target } = parseArgs();

  console.log(`🔌 Smee client starting`);
  console.log(`   Source: ${source}`);
  console.log(`   Target: ${target}`);

  const client = new SmeeClient({
    source,
    target,
    logger: console,
  });

  // Graceful shutdown on SIGINT
  process.on("SIGINT", async () => {
    console.log("\n⏹  Shutting down smee client...");
    await client.stop();
    console.log("✅ Smee client stopped.");
    process.exit(0);
  });

  client.onerror = (ev) => {
    console.error("❌ Smee client error:", ev.message ?? ev);
  };

  await client.start();
  console.log("✅ Smee client is now forwarding events.");
}

main().catch((err: unknown) => {
  console.error("❌ Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
