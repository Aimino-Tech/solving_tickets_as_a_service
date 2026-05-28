import "dotenv/config";

export const config = {
  port: parseInt(process.env.STAS_PORT || "3000", 10),
  label: process.env.STAS_LABEL || "stas:fix",

  github: {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: (process.env.GITHUB_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
  },

  opencode: {
    url: process.env.OPENCODE_URL || "http://localhost:4096",
    model: process.env.OPENCODE_MODEL || "anthropic/claude-sonnet-4-20250514",
  },

  limits: {
    maxConcurrent: parseInt(process.env.STAS_MAX_CONCURRENT || "3", 10),
  },
} as const;

export function requireConfig(): void {
  const missing: string[] = [];
  if (!config.github.appId) missing.push("GITHUB_APP_ID");
  if (!config.github.privateKey) missing.push("GITHUB_PRIVATE_KEY");
  if (!config.github.webhookSecret) missing.push("GITHUB_WEBHOOK_SECRET");
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    console.error("Copy .env.example to .env and fill in the values.");
    process.exit(1);
  }
}
