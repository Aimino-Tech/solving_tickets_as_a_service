/**
 * QualityGateReporter — formats and collects quality gate results for PR bodies.
 *
 * Transforms the existing QualityGateResult[] from the verification pipeline
 * into a collapsible GitHub-flavored markdown report that gets appended to
 * every PR body.
 *
 * Also provides persist/collect utilities so gate results survive across
 * pipeline phases and can be re-read for the PR composition step.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { rootLogger } from "../utils/logger.js";
import type { QualityGateResult } from "./types.js";

const log = rootLogger.child({ module: "quality-gate-reporter" });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Root directory for quality gate artifacts (relative to project root).
 *
 *  Evaluated on each call so tests can mock process.cwd(). */
function gatesRoot(): string {
  return resolve(process.cwd(), ".stas", "gates");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Simplified gate result for the markdown report.
 *
 * `passed: null` means the gate was skipped (neither pass nor fail).
 */
export interface GateResult {
  name: string;
  passed: boolean | null;
  details: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Persist an array of QualityGateResult to `.stas/gates/{fixId}/`.
 *
 * Writes one JSON file per gate so individual results can be inspected or
 * re-read by collectResults later.
 *
 * @param fixId — Unique fix identifier (e.g. issue number or run ID)
 * @param results — Array of QualityGateResult from the verification pipeline
 */
export async function persistGateResults(
  fixId: string,
  results: QualityGateResult[],
): Promise<void> {
    const gatesDir = join(gatesRoot(), fixId);

  try {
    await mkdir(gatesDir, { recursive: true });
  } catch (err) {
    log.warn({ err: String(err), fixId }, "Failed to create gates directory");
    return;
  }

  let saved = 0;
  for (const result of results) {
    const gateResult: GateResult = {
      name: result.gate,
      passed: result.passed,
      details: result.details,
      durationMs: 0, // QualityGateResult doesn't track duration; gates track it internally
    };

    const filePath = join(gatesDir, `${result.gate}.json`);
    try {
      await writeFile(filePath, JSON.stringify(gateResult, null, 2), "utf-8");
      saved++;
    } catch (err) {
      log.warn(
        { err: String(err), fixId, gate: result.gate },
        "Failed to persist gate result",
      );
    }
  }

  // Write a manifest with metadata
  const manifest = {
    fixId,
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    persistedAt: new Date().toISOString(),
  };

  try {
    await writeFile(
      join(gatesDir, "_manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );
  } catch {
    // non-fatal
  }

  log.info({ fixId, saved, total: results.length }, "Gate results persisted");
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

export class QualityGateReporter {
  /**
   * Format gate results into a collapsible GitHub-flavored markdown section.
   *
   * @param results — Array of GateResult to render
   * @returns Markdown string suitable for appending to a PR body
   */
  formatMarkdown(results: GateResult[]): string {
    if (results.length === 0) {
      return "";
    }

    const passed = results.filter((r) => r.passed === true).length;
    const total = results.length;

    const rows = results.map((r) => {
      const statusIcon = r.passed === true ? "✅ Passed" : r.passed === false ? "❌ Failed" : "⏭️ Skipped";
      const detail = r.details.length > 0 ? r.details[0] : (r.passed === null ? "Skipped" : "—");
      return `| \`${escapePipe(r.name)}\` | ${statusIcon} | ${escapePipe(detail)} |`;
    });

    return [
      "<details>",
      `<summary>🔍 STAS Quality Report — ${passed}/${total} gates passed</summary>`,
      "",
      "| Gate | Status | Detail |",
      "|---|---|---|",
      ...rows,
      "",
      "</details>",
      "<!-- stas-quality-report -->",
    ].join("\n");
  }

  /**
   * Read persisted gate artifacts from `.stas/gates/{fixId}/`.
   *
   * @param fixId — Unique fix identifier
   * @returns Array of GateResult re-hydrated from disk
   */
  async collectResults(fixId: string): Promise<GateResult[]> {
  const gatesDir = join(gatesRoot(), fixId);

    if (!existsSync(gatesDir)) {
      log.warn({ fixId }, "No persisted gate results found");
      return [];
    }

    let entries: string[];
    try {
      entries = await readdir(gatesDir);
    } catch (err) {
      log.warn({ err: String(err), fixId }, "Failed to read gates directory");
      return [];
    }

    const jsonFiles = entries.filter(
      (f) => f.endsWith(".json") && f !== "_manifest.json",
    );
    const results: GateResult[] = [];

    for (const file of jsonFiles) {
      try {
        const content = await readFile(join(gatesDir, file), "utf-8");
        const parsed = JSON.parse(content) as GateResult;
        // Validate shape
        if (typeof parsed.name === "string" && typeof parsed.passed !== "undefined") {
          results.push(parsed);
        }
      } catch (err) {
        log.warn(
          { err: String(err), fixId, file },
          "Failed to read gate result file",
        );
      }
    }

    return results;
  }

  /**
   * Convert existing QualityGateResult[] (from the verification pipeline)
   * into GateResult[] for the markdown reporter.
   *
   * This bridges the in-memory pipeline results to the report format without
   * requiring disk I/O.
   */
  static fromQualityGateResults(
    qualityGates: QualityGateResult[],
  ): GateResult[] {
    return qualityGates.map((qg) => ({
      name: qg.gate,
      passed: qg.passed,
      details: qg.details,
      durationMs: 0,
    }));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape pipe characters for markdown table cells. */
function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}
