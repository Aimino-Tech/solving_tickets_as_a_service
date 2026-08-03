/**
 * SYNTARO Plugin — OpenCode plugin for Solving Tickets As A Service.
 *
 * Provides tools for local development, webhook testing, and status checks
 * of the SYNTARO GitHub bot. Installed via opencode.json:
 *   { "plugin": ["@tarquinen/syntaro-plugin"] }
 *
 * Each tool delegates to the corresponding shell script in plugin/tools/,
 * so the scripts remain usable as standalone CLI tools outside of OpenCode.
 *
 * @packageDocumentation
 */
import { tool } from "@opencode-ai/plugin";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
/**
 * Resolve the plugin root directory from the tool context.
 * Falls back to the directory of this source file when context is unavailable.
 */
function pluginRoot(ctxDir) {
    // If we're invoked from a running OpenCode session, ctx.directory is the project root
    if (ctxDir)
        return ctxDir;
    // Fallback: walk up from the dist/ directory to find the package root
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "..");
}
/**
 * Resolve the tools/ directory path.
 */
function toolsDir(root) {
    return resolve(root, "plugin", "tools");
}
/**
 * Run a shell script and return its stdout. Throws on non-zero exit.
 */
function runScript(script, args, cwd) {
    const cmd = `bash "${script}" ${args.map((a) => `"${a}"`).join(" ")}`;
    try {
        return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["inherit", "pipe", "pipe"] }).trim();
    }
    catch (err) {
        const error = err;
        const stderr = error.stderr?.toString().trim() ?? error.message ?? "Unknown error";
        throw new Error(`Script "${script}" failed (${error.status ?? "?"}):\n${stderr}`);
    }
}
/**
 * Build an env-var override string for the shell script based on optional params.
 * Only includes values that are actually provided.
 */
function envOverride(provided, prefix = "") {
    const pairs = [];
    for (const [key, value] of Object.entries(provided)) {
        if (value !== undefined) {
            pairs.push(`${prefix}${key}=${value}`);
        }
    }
    return pairs.join(" ");
}
// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const syntaro_webhook_test = tool({
    description: "Send a test webhook event to a running SYNTARO bot to simulate a GitHub issue label event",
    args: {
        event: tool.schema
            .string()
            .default("issues.labeled")
            .describe("GitHub webhook event type (e.g. issues.labeled, issues.opened)"),
        payloadFile: tool.schema
            .string()
            .optional()
            .describe("Path to a JSON payload file (default: auto-generated test payload)"),
        syntaroUrl: tool.schema
            .string()
            .optional()
            .describe("SYNTARO bot URL override (default: http://localhost:3000)"),
    },
    async execute(args, ctx) {
        const root = pluginRoot(ctx.directory);
        const script = resolve(toolsDir(root), "syntaro-webhook-test.sh");
        if (!existsSync(script)) {
            return { output: `❌ Tool script not found: ${script}` };
        }
        const env = envOverride({ SYNTARO_URL: args.syntaroUrl });
        const cmdArgs = [args.event];
        if (args.payloadFile)
            cmdArgs.push(args.payloadFile);
        const scriptArgs = cmdArgs.map((a) => `"${a}"`).join(" ");
        const fullCmd = env ? `${env} bash "${script}" ${scriptArgs}` : `bash "${script}" ${scriptArgs}`;
        try {
            const output = execSync(fullCmd, {
                cwd: root,
                encoding: "utf-8",
                stdio: ["inherit", "pipe", "pipe"],
            }).trim();
            return { output, metadata: { tool: "syntaro_webhook_test", event: args.event } };
        }
        catch (err) {
            const error = err;
            const stderr = error.stderr?.toString().trim() ?? error.message ?? "Unknown error";
            return { output: `❌ Webhook test failed:\n${stderr}`, metadata: { tool: "syntaro_webhook_test", error: true } };
        }
    },
});
const syntaro_config_validate = tool({
    description: "Validate or initialize the SYNTARO .env configuration file",
    args: {
        mode: tool.schema
            .string()
            .default("check")
            .describe("Action: 'check' to validate existing .env, 'init' to create from .env.example"),
        envFile: tool.schema
            .string()
            .optional()
            .describe("Path to .env file (default: <project>/.env)"),
    },
    async execute(args, ctx) {
        const root = pluginRoot(ctx.directory);
        const script = resolve(toolsDir(root), "syntaro-config.sh");
        if (!existsSync(script)) {
            return { output: `❌ Tool script not found: ${script}` };
        }
        const env = envOverride({ ENV_FILE: args.envFile });
        const fullCmd = env
            ? `${env} bash "${script}" "${args.mode}"`
            : `bash "${script}" "${args.mode}"`;
        try {
            const output = execSync(fullCmd, {
                cwd: root,
                encoding: "utf-8",
                stdio: ["inherit", "pipe", "pipe"],
            }).trim();
            return { output, metadata: { tool: "syntaro_config_validate", mode: args.mode } };
        }
        catch (err) {
            const error = err;
            const stderr = error.stderr?.toString().trim() ?? error.message ?? "Unknown error";
            return { output: `❌ Config validation failed:\n${stderr}`, metadata: { tool: "syntaro_config_validate", error: true } };
        }
    },
});
const syntaro_status = tool({
    description: "Check if SYNTARO bot and OpenCode serve are running and healthy",
    args: {
        syntaroUrl: tool.schema
            .string()
            .optional()
            .describe("SYNTARO bot URL override (default: http://localhost:3000)"),
        opencodeUrl: tool.schema
            .string()
            .optional()
            .describe("OpenCode serve URL override (default: http://localhost:4096)"),
    },
    async execute(args, ctx) {
        const root = pluginRoot(ctx.directory);
        const script = resolve(toolsDir(root), "syntaro-status.sh");
        if (!existsSync(script)) {
            return { output: `❌ Tool script not found: ${script}` };
        }
        const env = envOverride({ SYNTARO_URL: args.syntaroUrl, OPENCODE_URL: args.opencodeUrl });
        const fullCmd = env
            ? `${env} bash "${script}"`
            : `bash "${script}"`;
        try {
            const output = execSync(fullCmd, {
                cwd: root,
                encoding: "utf-8",
                stdio: ["inherit", "pipe", "pipe"],
            }).trim();
            return { output, metadata: { tool: "syntaro_status" } };
        }
        catch (err) {
            const error = err;
            const stderr = error.stderr?.toString().trim() ?? error.message ?? "Unknown error";
            return { output: `❌ Status check failed:\n${stderr}`, metadata: { tool: "syntaro_status", error: true } };
        }
    },
});
const syntaro_dev_start = tool({
    description: "Start the local SYNTARO development environment (OpenCode serve + bot)",
    args: {
        mode: tool.schema
            .string()
            .default("full")
            .describe("Start mode: 'full' (both), 'bot-only', 'opencode-only'"),
        opencodePort: tool.schema
            .string()
            .optional()
            .describe("OpenCode serve port override (default: 4096)"),
        syntaroPort: tool.schema
            .string()
            .optional()
            .describe("SYNTARO bot port override (default: 3000)"),
    },
    async execute(args, ctx) {
        const root = pluginRoot(ctx.directory);
        const script = resolve(toolsDir(root), "syntaro-dev.sh");
        if (!existsSync(script)) {
            return { output: `❌ Tool script not found: ${script}` };
        }
        const flag = args.mode === "bot-only"
            ? "--bot-only"
            : args.mode === "opencode-only"
                ? "--opencode-only"
                : "";
        const env = envOverride({ OPENCODE_PORT: args.opencodePort, SYNTARO_PORT: args.syntaroPort });
        const fullCmd = env
            ? `${env} bash "${script}" ${flag}`
            : `bash "${script}" ${flag}`;
        try {
            const output = execSync(fullCmd, {
                cwd: root,
                encoding: "utf-8",
                stdio: ["inherit", "pipe", "pipe"],
                timeout: 10_000,
            }).trim();
            return { output, metadata: { tool: "syntaro_dev_start", mode: args.mode } };
        }
        catch (err) {
            const error = err;
            const stderr = error.stderr?.toString().trim() ?? error.message ?? "Unknown error";
            return { output: `❌ Dev start failed:\n${stderr}`, metadata: { tool: "syntaro_dev_start", error: true } };
        }
    },
});
// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------
export default async function syntaroPlugin() {
    return {
        tool: {
            syntaro_webhook_test,
            syntaro_config_validate,
            syntaro_status,
            syntaro_dev_start,
        },
    };
}
//# sourceMappingURL=index.js.map