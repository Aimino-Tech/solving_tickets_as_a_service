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
import type { QualityGateResult } from '../types/agent-types.js';
import { rootLogger } from '../utils/logger.js';

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
   * The output uses `<details>` / `<summary>` tags for a clean collapsed
   * overview and an HTML table with Gate | Status | Detail columns showing
   * every gate result inline.
   *
   * @param results  Array of QualityGateResult from the verification pipeline.
   * @returns A markdown string ready to embed in a PR body.
   */
  formatMarkdown(results: QualityGateResult[]): string {
    if (results.length === 0) {
      return [
        '<!-- syntaro-quality-report -->',
        '',
        '## Quality Gates',
        '',
        '_No quality gates were run for this fix._',
        '',
        '<!-- /syntaro-quality-report -->',
      ].join('\n');
    }

    const passedCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    const allPassed = passedCount === totalCount;

    const summaryEmoji = allPassed ? '✅' : '❌';
    const summaryLine = `${summaryEmoji} Quality Gates — ${passedCount}/${totalCount} passed`;

    const rows = results.map((r) => this.formatRow(r));

    // Build the table
    const tableHeader = ['| Gate | Status | Detail |', '|------|--------|--------|'];
    const table = [...tableHeader, ...rows];

    return [
      '<!-- syntaro-quality-report -->',
      '',
      `<details>`,
      `<summary>${summaryLine}</summary>`,
      '',
      ...table,
      '',
      '</details>',
      '',
      '<!-- /syntaro-quality-report -->',
    ].join('\n');
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
   * `.syntaro/gates/{fixId}/{gateName}.json` for audit persistence.
   *
   * Creates the directory tree if it does not exist.
   *
   * @param fixId    Unique identifier for the fix run (e.g. issue number or UUID).
   * @param result   The gate result to persist.
   */
  async writeGateResult(fixId: string | number, result: QualityGateResult): Promise<void> {
    const dir = join(process.cwd(), '.syntaro', 'gates', String(fixId));
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
