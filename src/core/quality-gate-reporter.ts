/**
 * QualityGateReporter — Formats quality gate results as GitHub-flavored
 * markdown for inclusion in PR bodies, and persists structured JSON results
 * to disk for audit trail.
 *
 * Each quality gate runs an OSS tool and produces a QualityGateResult.
 * This class takes those results and produces a collapsible markdown report
 * that renders correctly on GitHub.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QualityGateResult } from '../agent/types.js';
import { rootLogger } from '../utils/logger.js';

/**
 * Simplified gate result for the markdown report.
 * Bridges between verification pipeline results and the report format.
 */
export interface GateResult {
  name: string;
  passed: boolean | null;
  details: string[];
  durationMs: number;
}

const log = rootLogger.child({ module: 'quality-gate-reporter' });

/**
 * Gate display names for the markdown report.
 */
const GATE_LABELS: Record<string, string> = {
  reality: 'Reality Check',
  compile: 'Compile Check',
  test_integrity: 'Test Integrity',
  hallucination: 'Hallucination Scan',
  coverage: 'Coverage Check',
  'anti-liar': 'Anti-Liar Gate',
  mutation: 'Mutation Test',
  secrets: 'Secrets Scan',
};

export class QualityGateReporter {
  /**
   * Format quality gate results as a GitHub-collapsible markdown section.
   *
   * Accepts either QualityGateResult[] (from the verification pipeline) or
   * GateResult[] (from fromQualityGateResults conversion). When GateResult[]
   * is passed, it is converted internally to QualityGateResult[].
   *
   * The output uses `<details>` / `<summary>` tags for a clean collapsed
   * overview and an HTML table with Gate | Status | Detail columns showing
   * every gate result inline.
   */
  formatMarkdown(results: QualityGateResult[]): string;
  formatMarkdown(results: GateResult[]): string;
  formatMarkdown(results: QualityGateResult[] | GateResult[]): string {
    if (results.length === 0) {
      return [
        '<!-- stas-quality-report -->',
        '',
        '## Quality Gates',
        '',
        '_No quality gates were run for this fix._',
        '',
        '<!-- /stas-quality-report -->',
      ].join('\n');
    }

    // GateResult[] (has 'name' not 'gate') → convert to QualityGateResult[]
    if ('name' in results[0] && !('gate' in results[0])) {
      const gateResults = (results as GateResult[]).map((r) => ({
        gate: r.name as QualityGateResult['gate'],
        passed: r.passed ?? false,
        ossTool: '',
        command: '',
        stdout: '',
        stderr: '',
        details: r.details,
      }));
      return this.formatMarkdown(gateResults);
    }

    const gateResults = results as QualityGateResult[];
    const passedCount = gateResults.filter((r) => r.passed).length;
    const totalCount = gateResults.length;
    const allPassed = passedCount === totalCount;

    const summaryEmoji = allPassed ? '✅' : '❌';
    const summaryLine = `${summaryEmoji} Quality Gates — ${passedCount}/${totalCount} passed`;

    const rows = gateResults.map((r) => this.formatRow(r));

    const tableHeader = ['| Gate | Status | Detail |', '|------|--------|--------|'];
    const table = [...tableHeader, ...rows];

    return [
      '<!-- stas-quality-report -->',
      '',
      `<details>`,
      `<summary>${summaryLine}</summary>`,
      '',
      ...table,
      '',
      '</details>',
      '',
      '<!-- /stas-quality-report -->',
    ].join('\n');
  }

  /**
   * Convert QualityGateResult[] (from the verification pipeline) into
   * GateResult[] for the markdown reporter.
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

  /**
   * Format a single gate result as a markdown table row.
   */
  private formatRow(result: QualityGateResult): string {
    const icon = result.passed ? '✅' : '❌';
    const status = result.passed ? 'Pass' : 'Fail';
    const label = GATE_LABELS[result.gate] ?? result.gate;
    const detail = this.buildDetail(result);
    return `| **${label}** | ${icon} ${status} | ${detail} |`;
  }

  /**
   * Build a short detail string for a gate result.
   * If the gate passed, show the OSS tool. If it failed, summarize why.
   */
  private buildDetail(result: QualityGateResult): string {
    if (result.passed) {
      return result.details.length > 0
        ? result.details[0]
        : `Passed via \`${result.ossTool}\``;
    }

    // Find the first meaningful failure detail
    const failReason =
      result.details.find(
        (d) =>
          !d.includes('hallucination-grep') &&
          !d.startsWith('Found ') &&
          !d.startsWith('Missing ') &&
          !d.startsWith('All '),
      ) ?? result.stdout.slice(0, 120);

    return failReason
      ? `${failReason.slice(0, 200)}`
      : `Failed via \`${result.ossTool}\``;
  }

  /**
   * Write a single gate's structured JSON result to
   * `.stas/gates/{fixId}/{gateName}.json` for audit persistence.
   *
   * Creates the directory tree if it does not exist.
   *
   * @param fixId    Unique identifier for the fix run (e.g. issue number or UUID).
   * @param result   The gate result to persist.
   */
  async writeGateResult(fixId: string | number, result: QualityGateResult): Promise<void> {
    const dir = join(process.cwd(), '.stas', 'gates', String(fixId));
    const filePath = join(dir, `${result.gate}.json`);

    try {
      await mkdir(dir, { recursive: true });

      const payload = {
        gate: result.gate,
        passed: result.passed,
        ossTool: result.ossTool,
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        details: result.details,
        timestamp: new Date().toISOString(),
      };

      await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      log.warn({ err: String(err), gate: result.gate, fixId }, 'Failed to write gate result to disk');
    }
  }

  /**
   * Persist all gate results for a fix run.
   * Convenience wrapper around writeGateResult.
   *
   * @param fixId    Unique identifier for the fix run.
   * @param results  All gate results to persist.
   */
  async writeAllGateResults(fixId: string | number, results: QualityGateResult[]): Promise<void> {
    await Promise.all(results.map((r) => this.writeGateResult(fixId, r)));
  }
}
