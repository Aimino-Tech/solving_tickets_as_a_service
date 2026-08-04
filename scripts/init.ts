#!/usr/bin/env tsx
/**
 * init.ts — SYNTARO interactive setup wizard
 *
 * Guides users through configuring SYNTARO for their repository.
 * Prompts for all required config, validates inputs, generates .env,
 * runs npm install, and optionally starts the dev environment.
 *
 * Usage:
 *   npx syntaro-init
 *   tsx scripts/init.ts
 *   npm run init
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { execSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnvVars {
  [key: string]: string;
}

// ---------------------------------------------------------------------------
// Terminal styling
// ---------------------------------------------------------------------------

function bold(s: string): string {
  return `\x1b[1m${s}\x1b[22m`;
}

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[22m`;
}

function green(s: string): string {
  return `\x1b[32m${s}\x1b[39m`;
}

function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[39m`;
}

function red(s: string): string {
  return `\x1b[31m${s}\x1b[39m`;
}

function cyan(s: string): string {
  return `\x1b[36m${s}\x1b[39m`;
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

function wrapPrompt<T>(fn: () => Promise<T>): Promise<T> {
  return fn().finally(() => {});
}

async function ask(
  question: string,
  options?: {
    default?: string;
    required?: boolean;
    validate?: (value: string) => string | null;
  },
): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const hint = options?.default
        ? ` [${options.default}]`
        : options?.required
          ? ` ${red("*")}`
          : "";
      const raw = await rl.question(`${bold(question)}${dim(hint)}: `);
      const value = raw.trim() || options?.default || "";

      if (options?.required && !value) {
        console.log(red("  ✖ This field is required."));
        continue;
      }

      if (options?.validate && value) {
        const error = options.validate(value);
        if (error) {
          console.log(red(`  ✖ ${error}`));
          continue;
        }
      }

      return value;
    }
  } finally {
    rl.close();
  }
}

async function askMultiLine(
  question: string,
  options?: {
    required?: boolean;
    validate?: (value: string) => string | null;
  },
): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const lines: string[] = [];
  try {
    console.log(bold(question));
    console.log(dim("(Paste the full value. Press Enter on an empty line when done, or Ctrl+D)\n"));
    while (true) {
      const raw = await rl.question("");
      if (raw.trim() === "" && lines.length > 0 && lines[lines.length - 1] !== "") {
        // Two consecutive empty lines = done
        break;
      }
      lines.push(raw);
    }
    const value = lines.join("\n").trim();

    if (options?.required && !value) {
      console.log(red("  ✖ This field is required."));
      return askMultiLine(question, options);
    }

    if (options?.validate && value) {
      const error = options.validate(value);
      if (error) {
        console.log(red(`  ✖ ${error}`));
        return askMultiLine(question, options);
      }
    }

    return value;
  } finally {
    rl.close();
  }
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const hint = defaultYes ? "Y/n" : "y/N";
    const raw = await rl.question(`${bold(question)} ${dim(`(${hint})`)}: `);
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return defaultYes;
    return trimmed === "y" || trimmed === "yes";
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function printBanner(): void {
  console.log(`\n${cyan(`
  ███████  ████████  █████   ██████
  ██         ██    ██   ██  ██   ██
  ███████    ██    ███████  ██████       ${bold("SYNTARO")}
       ██    ██    ██   ██  ██   ██
  ███████    ██    ██   ██  ██   ██      ${dim("Label an issue. Get a PR.")}

  ${bold("Interactive Setup Wizard")}
`)}`);
  console.log(dim("This wizard will guide you through configuring SYNTARO for your repository."));
  console.log(dim("Press Ctrl+C at any time. Progress is written only when you confirm.\n"));

  console.log(yellow("Before we begin, make sure you have:"));
  console.log(dim("  1. A GitHub App created at https://github.com/settings/apps/new"));
  console.log(dim("  2. Redis running (or a Redis URL handy)"));
  console.log(dim("  3. OpenCode CLI installed (if using self-hosted OpenCode)"));
  console.log(dim("  4. (Optional) E2B API key from https://e2b.dev\n"));
}

function printSection(title: string, subtitle?: string): void {
  console.log(`\n${bold("━━━ " + title + " " + "━".repeat(Math.max(0, 56 - title.length)))}`);
  if (subtitle) console.log(dim(subtitle));
  console.log();
}

function printValue(key: string, value: string): void {
  const display = maskSecret(key, value);
  console.log(`  ${green("✔")} ${bold(key)}=${dim(display)}`);
}

function maskSecret(key: string, value: string): string {
  const sensitive = key.includes("SECRET") || key.includes("KEY") || key.includes("PASSWORD");
  if (!sensitive || !value) return value || dim("<empty>");
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****";
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function isValidUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

function validatePort(value: string): string | null {
  if (!/^\d{1,5}$/.test(value)) return "Must be a number";
  const num = parseInt(value, 10);
  if (num < 1 || num > 65535) return "Must be between 1 and 65535";
  return null;
}

function validateNumber(value: string): string | null {
  if (!/^\d+$/.test(value)) return "Must be a positive number";
  return null;
}

function validatePem(value: string): string | null {
  if (!value.includes("-----BEGIN")) return "Must be a PEM-encoded private key (starts with -----BEGIN)";
  return null;
}

// ---------------------------------------------------------------------------
// Environment file generation
// ---------------------------------------------------------------------------

function generateEnvFile(env: EnvVars): string {
  const lines: string[] = [];
  const h = (text: string) => lines.push(`# ${text}`);

  h("=============================================================================");
  h("SYNTARO");
  h(`Generated by npx syntaro-init on ${new Date().toISOString()}`);
  h("=============================================================================");
  lines.push("");

  // GitHub App
  h("=== GitHub App ===");
  lines.push(`GITHUB_APP_ID=${env.GITHUB_APP_ID}`);

  if (env.GITHUB_APP_PRIVATE_KEY_PATH) {
    lines.push(`GITHUB_APP_PRIVATE_KEY_PATH=${env.GITHUB_APP_PRIVATE_KEY_PATH}`);
  }

  // Write the private key inline with escaped newlines (standard .env format)
  // Replace actual newlines with literal \n for single-line .env values
  lines.push(`GITHUB_APP_PRIVATE_KEY=${env.GITHUB_APP_PRIVATE_KEY.replace(/\n/g, "\\n")}`);
  lines.push(`GITHUB_WEBHOOK_SECRET=${env.GITHUB_WEBHOOK_SECRET}`);
  if (env.GITHUB_OAUTH_CLIENT_ID) {
    lines.push(`GITHUB_OAUTH_CLIENT_ID=${env.GITHUB_OAUTH_CLIENT_ID}`);
  }
  if (env.GITHUB_OAUTH_CLIENT_SECRET) {
    lines.push(`GITHUB_OAUTH_CLIENT_SECRET=${env.GITHUB_OAUTH_CLIENT_SECRET}`);
  }
  lines.push("");

  // Redis
  h("=== Queue (Redis) ===");
  lines.push(`REDIS_URL=${env.REDIS_URL}`);
  lines.push("");

  // OpenCode
  h("=== OpenCode ===");
  lines.push(`OPENCODE_URL=${env.OPENCODE_URL}`);
  lines.push(`OPENCODE_MODEL=${env.OPENCODE_MODEL}`);
  if (env.OPENCODE_API_KEY) {
    lines.push(`OPENCODE_API_KEY=${env.OPENCODE_API_KEY}`);
  }
  lines.push("");

  // Direct LLM (OpenCode Go)
  h("=== Direct LLM (OpenCode Go) ===");
  lines.push(`OPENCODE_DIRECT_MODEL=${env.OPENCODE_DIRECT_MODEL}`);
  lines.push(`OPENCODE_FALLBACK_MODEL=${env.OPENCODE_FALLBACK_MODEL}`);
  lines.push("");

  // Sandbox
  if (env.E2B_API_KEY) {
    h("=== Sandbox ===");
    lines.push(`E2B_API_KEY=${env.E2B_API_KEY}`);
    lines.push(`E2B_SANDBOX_TIMEOUT_MS=${env.E2B_SANDBOX_TIMEOUT_MS}`);
    lines.push("");
  }

  // Bot settings
  h("=== Bot Settings ===");
  lines.push(`SYNTARO_LABEL=${env.SYNTARO_LABEL}`);
  lines.push(`BOT_NAME=${env.BOT_NAME}`);

  if (env.PORT) {
    lines.push(`PORT=${env.PORT}`);
  }

  if (env.ADMIN_API_KEY) {
    lines.push(`ADMIN_API_KEY=${env.ADMIN_API_KEY}`);
  }

  // Optional extras
  if (env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY === "true") {
    lines.push("");
    h("=== Development ===");
    lines.push("DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY=true");
  }

  lines.push("");
  return lines.join("\n");
}

function printSummary(env: EnvVars): void {
  console.log(`\n${green("✔ All inputs collected!")}`);
  console.log(bold("\nConfiguration summary:\n"));

  const pad = Math.max(...Object.keys(env).map((k) => k.length)) + 2;
  for (const [key, value] of Object.entries(env)) {
    const k = key.padEnd(pad);
    console.log(`  ${k}${dim("=")} ${maskSecret(key, value)}`);
  }
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  printBanner();

  const env: EnvVars = {};

  // ==========================================================================
  // SECTION 1: GitHub App
  // ==========================================================================
  printSection(
    "GitHub App Configuration",
    "Create one at https://github.com/settings/apps/new\n" +
      "  Required permissions: Issues (read+write), Pull Requests (write), Contents (write)\n" +
      "  Subscribe to: Issues, Issue comments, Pull requests",
  );

  env.GITHUB_APP_ID = await ask("GitHub App ID", {
    required: true,
    validate: (v) => (/^\d+$/.test(v) ? null : "Must be a numeric ID (e.g. 123456)"),
  });
  printValue("GITHUB_APP_ID", env.GITHUB_APP_ID);

  // Private key: offer file path first, fallback to paste
  const useKeyFile = await confirm("Do you have a private key PEM file on disk?", true);
  if (useKeyFile) {
    const keyPath = await ask("Path to private key PEM file", {
      required: true,
      validate: (v) => (fs.existsSync(v) ? null : `File not found: ${v}`),
    });
    env.GITHUB_APP_PRIVATE_KEY_PATH = path.resolve(keyPath);
    env.GITHUB_APP_PRIVATE_KEY = fs.readFileSync(keyPath, "utf-8").trim();
    console.log(green(`  ✓ Read key (${env.GITHUB_APP_PRIVATE_KEY.length} bytes)`));
    printValue("GITHUB_APP_PRIVATE_KEY_PATH", env.GITHUB_APP_PRIVATE_KEY_PATH);
  } else {
    const keyContent = await askMultiLine("Paste your private key (PEM):", {
      required: true,
      validate: validatePem,
    });
    env.GITHUB_APP_PRIVATE_KEY = keyContent;
    console.log(green(`  ✓ Captured key (${keyContent.length} bytes)`));
  }

  env.GITHUB_WEBHOOK_SECRET = await ask("Webhook secret", {
    required: true,
    validate: (v) => (v.length >= 8 ? null : "Should be at least 8 characters"),
  });
  printValue("GITHUB_WEBHOOK_SECRET", env.GITHUB_WEBHOOK_SECRET);

  // Additional GitHub options
  const moreGitHub = await confirm("Configure additional GitHub settings?", false);
  if (moreGitHub) {
    const webhookPath = await ask("Webhook path", { default: "/webhook" });
    if (webhookPath !== "/webhook") env.GITHUB_WEBHOOK_PATH = webhookPath;

    const oauthId = await ask("GitHub OAuth client ID", { required: false });
    if (oauthId) {
      env.GITHUB_OAUTH_CLIENT_ID = oauthId;
      printValue("GITHUB_OAUTH_CLIENT_ID", oauthId);
    }

    const oauthSecret = await ask("GitHub OAuth client secret", { required: false });
    if (oauthSecret) {
      env.GITHUB_OAUTH_CLIENT_SECRET = oauthSecret;
      printValue("GITHUB_OAUTH_CLIENT_SECRET", oauthSecret);
    }
  }

  // ==========================================================================
  // SECTION 2: Redis
  // ==========================================================================
  printSection(
    "Redis Configuration",
    "SYNTARO uses Redis for the job queue. Default: redis://localhost:6379",
  );

  env.REDIS_URL = await ask("Redis URL", {
    default: "redis://localhost:6379",
    validate: (v) => (v.startsWith("redis://") || v.startsWith("rediss://") ? null : "Must start with redis:// or rediss://"),
  });
  printValue("REDIS_URL", env.REDIS_URL);

  // Ask for password if not already in URL
  if (env.REDIS_URL === "redis://localhost:6379") {
    const hasPassword = await confirm("Does your Redis require a password?", false);
    if (hasPassword) {
      const password = await ask("Redis password", { required: true });
      env.REDIS_URL = `redis://:${password}@localhost:6379`;
      console.log(green("  ✓ Password embedded in REDIS_URL"));
    }
  }

  // ==========================================================================
  // SECTION 3: OpenCode
  // ==========================================================================
  printSection(
    "OpenCode Configuration",
    "OpenCode is the coding agent that investigates and fixes issues.\n" +
      "  Run: opencode serve --port 4096",
  );

  env.OPENCODE_URL = await ask("OpenCode serve URL", {
    default: "http://localhost:4096",
    validate: (v) => (isValidUrl(v) ? null : "Must be a valid URL"),
  });
  printValue("OPENCODE_URL", env.OPENCODE_URL);

  env.OPENCODE_MODEL = await ask("OpenCode model", {
    default: "anthropic/claude-sonnet-4-20250514",
  });
  printValue("OPENCODE_MODEL", env.OPENCODE_MODEL);

  const useOpencodeKey = await confirm("Configure OpenCode API key?", false);
  if (useOpencodeKey) {
    env.OPENCODE_API_KEY = await ask("OpenCode API key", {
      validate: (v) => (v && v.length < 10 ? "Looks too short for an API key" : null),
    });
    if (env.OPENCODE_API_KEY) {
      printValue("OPENCODE_API_KEY", env.OPENCODE_API_KEY);
    }
  }

  // ==========================================================================
  // SECTION 4: Triage LLM
  // ==========================================================================
  printSection(
    "Direct LLM (OpenCode Go)",
    "A cheap model for classifying issues before the fix agent runs.\n" +
      "  Uses OpenCode Go's OpenAI-compatible endpoint. The API key is hardcoded.\n" +
      "  Default: deepseek-v4-flash (triage), deepseek-v4-pro (fallback fix)",
  );

  env.OPENCODE_DIRECT_MODEL = await ask("Triage model", {
    default: "deepseek-v4-flash",
  });
  printValue("OPENCODE_DIRECT_MODEL", env.OPENCODE_DIRECT_MODEL);
  env.OPENCODE_FALLBACK_MODEL = await ask("Fallback fix model", {
    default: "deepseek-v4-pro",
  });
  printValue("OPENCODE_FALLBACK_MODEL", env.OPENCODE_FALLBACK_MODEL);

  // ==========================================================================
  // SECTION 5: Sandbox
  // ==========================================================================
  printSection(
    "Sandbox Configuration",
    "Every fix runs in an isolated sandbox. Required for production.\n" +
      "  Optional for local development. Get a free API key at https://e2b.dev",
  );

  const useSandbox = await confirm("Configure E2B sandbox?", false);
  if (useSandbox) {
    env.E2B_API_KEY = await ask("E2B API key", {
      validate: (v) => (v && v.length < 10 ? "Looks too short for an API key" : null),
    });
    if (env.E2B_API_KEY) {
      printValue("E2B_API_KEY", env.E2B_API_KEY);
    }
    env.E2B_SANDBOX_TIMEOUT_MS = await ask("Sandbox timeout (ms)", {
      default: "600000",
      validate: validateNumber,
    });
    printValue("E2B_SANDBOX_TIMEOUT_MS", env.E2B_SANDBOX_TIMEOUT_MS);
  }

  // ==========================================================================
  // SECTION 6: Bot Config
  // ==========================================================================
  printSection(
    "Bot Settings",
    "Configure how SYNTARO behaves on your repository.",
  );

  env.SYNTARO_LABEL = await ask("Trigger label", {
    default: "syntaro:fix",
  });
  printValue("SYNTARO_LABEL", env.SYNTARO_LABEL);

  env.BOT_NAME = await ask("Bot display name", {
    default: "SYNTARO",
  });
  printValue("BOT_NAME", env.BOT_NAME);

  const configureAdmin = await confirm("Configure admin API key?", false);
  if (configureAdmin) {
    env.ADMIN_API_KEY = await ask("Admin API key", {
      validate: (v) => (v && v.length < 8 ? "Should be at least 8 characters" : null),
    });
    if (env.ADMIN_API_KEY) {
      printValue("ADMIN_API_KEY", env.ADMIN_API_KEY);
    }
  }

  const customPort = await confirm("Use a custom webhook port?", false);
  if (customPort) {
    env.PORT = await ask("Webhook server port", {
      default: "3000",
      validate: validatePort,
    });
    printValue("PORT", env.PORT);
  }

  const useDevMode = await confirm("Enable development mode (skip webhook signature validation)?", false);
  if (useDevMode) {
    env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY = "true";
    console.log(dim("  ⚠ Never enable this in production."));
  }

  // ==========================================================================
  // Generate .env
  // ==========================================================================
  printSection("Generating Configuration");

  const envContent = generateEnvFile(env);
  const envPath = path.resolve(process.cwd(), ".env");

  // Check if .env already exists
  if (fs.existsSync(envPath)) {
    const overwrite = await confirm(".env already exists. Overwrite?", false);
    if (!overwrite) {
      console.log(yellow("  ⚠ Keeping existing .env. Writing to .env.syntaro-init instead."));
      fs.writeFileSync(".env.syntaro-init", envContent, "utf-8");
      console.log(green("  ✓ Wrote .env.syntaro-init (review and merge manually)"));
    } else {
      fs.writeFileSync(envPath, envContent, "utf-8");
      console.log(green("  ✓ .env file updated"));
    }
  } else {
    fs.writeFileSync(envPath, envContent, "utf-8");
    console.log(green("  ✓ .env file created"));
  }

  // Print summary
  printSummary(env);

  // ==========================================================================
  // Next Steps
  // ==========================================================================
  printSection("Install & Run");

  const runInstall = await confirm("Run npm install now?", true);
  if (runInstall) {
    console.log(dim("\nRunning npm install...\n"));
    try {
      execSync("npm install", { stdio: "inherit", cwd: process.cwd() });
      console.log(green("\n  ✓ npm install complete"));
    } catch {
      console.log(yellow("\n  ⚠ npm install had issues. You can run it manually with: npm install"));
    }
  }

  const startDev = await confirm("Start development environment?", false);
  if (startDev) {
    console.log(dim("\nStarting SYNTARO in development mode...\n"));
    console.log(dim("  Press Ctrl+C to stop the server.\n"));
    try {
      execSync("npm run dev", { stdio: "inherit", cwd: process.cwd() });
    } catch {
      console.log(yellow("\n  ⚠ Dev environment stopped. Restart with: npm run dev"));
    }
  }

  // ==========================================================================
  // Goodbye
  // ==========================================================================
  console.log(`\n${green(`
  ┌──────────────────────────────────────────┐
  │          ${bold("Setup Complete!")}            │
  └──────────────────────────────────────────┘
`)}`);

  console.log(`${bold("Next steps:")}`);
  console.log(`  1. ${bold("Start Redis:")}    ${dim("redis-server")}`);
  console.log(`  2. ${bold("Start OpenCode:")}  ${dim("opencode serve --port 4096")}`);
  console.log(`  3. ${bold("Start SYNTARO:")}      ${dim("npm run dev")}`);
  console.log(`  4. ${bold("Configure webhook:")} Point your GitHub App to http://your-server:${env.PORT || "3000"}/webhook`);
  console.log(`  5. ${bold("Test it:")}         Label any issue with "${env.SYNTARO_LABEL}"`);
  console.log();
  console.log(dim("  Documentation: https://github.com/tamnguyen08/solving_tickets_as_a_service"));
  console.log(dim("  Need help?      Open a GitHub issue\n"));
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

main()
  .catch((err) => {
    console.error(`\n${red("Error:")} ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
