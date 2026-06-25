/**
 * STAS Plugin — OpenCode plugin for Solving Tickets As A Service.
 *
 * Provides tools for local development, webhook testing, and status checks
 * of the STAS GitHub bot. Installed via opencode.json:
 *   { "plugin": ["@tarquinen/stas-plugin"] }
 *
 * Each tool delegates to the corresponding shell script in plugin/tools/,
 * so the scripts remain usable as standalone CLI tools outside of OpenCode.
 *
 * @packageDocumentation
 */
import { type Hooks } from "@opencode-ai/plugin";
export default function stasPlugin(): Promise<Hooks>;
