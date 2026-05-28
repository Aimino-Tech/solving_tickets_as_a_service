/**
 * STAS Plugin — OpenCode plugin for Solving Tickets As A Service.
 *
 * Provides tools for local development, webhook testing, and deployment
 * of the STAS GitHub bot. Installed via opencode.json:
 *   { "plugin": ["@tarquinen/stas-plugin"] }
 *
 * Usage:
 *   /stas:dev      Start local dev environment
 *   /stas:webhook  Simulate a webhook event
 *   /stas:status   Check bot status
 *   /stas:config   Validate environment config
 */

export function registerTools(): void {
  // Tools are registered as CLI commands in tools/
  // The WORKFLOW.md references them as part of the dev loop
  console.log("STAS plugin loaded. Available: /stas:dev, /stas:webhook, /stas:status, /stas:config")
}
