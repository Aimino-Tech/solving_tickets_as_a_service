#!/usr/bin/env node

// =============================================================================
// SYNTARO Full Regression Report Generator
//
// Reads all eval result JSON files from a directory, aggregates pass rates,
// and generates both a structured JSON report and a human-readable Markdown
// summary.
//
// Usage:
//   node eval/scripts/full-report.mjs \
//     --input-dir eval/results \
//     --output eval/results/full-report.json \
//     --markdown eval/results/full-report.md
//
// Output:
//   - JSON: structured report with per-group stats, overall pass rate,
//           red team findings, and regression deltas
//   - Markdown: human-readable summary suitable for PR comments or CI output
// =============================================================================

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { inputDir: 'eval/results', output: 'eval/results/full-report.json', markdown: '' };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input-dir':
        opts.inputDir = args[++i];
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--markdown':
        opts.markdown = args[++i];
        break;
      default:
        console.warn(`[full-report] Ignoring unknown option: ${args[i]}`);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Result file parsing
// ---------------------------------------------------------------------------
function loadJsonFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[full-report] Failed to parse result file: ${filePath}`, err.message);
    return null;
  }
}

/**
 * Read all JSON result files from inputDir, excluding known report files
 * to avoid re-processing previous aggregations.
 */
function collectResultFiles(inputDir) {
  if (!existsSync(inputDir)) {
    console.error(`[full-report] Input directory not found: ${inputDir}`);
    return [];
  }

  const excludePatterns = ['full-report.json', 'aggregated.json', 'full-report.md'];

  return readdirSync(inputDir)
    .filter((f) => f.endsWith('.json') && !excludePatterns.includes(f))
    .map((f) => join(inputDir, f));
}

// ---------------------------------------------------------------------------
// Result parsing per group
// ---------------------------------------------------------------------------
function classifyGroup(fileName) {
  if (fileName.startsWith('group1')) return 'eval-group-1';
  if (fileName.startsWith('group2')) return 'eval-group-2';
  if (fileName.startsWith('group3')) return 'eval-group-3';
  if (fileName.startsWith('redteam')) return 'red-team';
  return 'unknown';
}

/**
 * Extract test-level results from a promptfoo eval result file.
 * Adapts to different promptfoo output shapes.
 */
function extractTestResults(data) {
  const results = [];

  // Shape 1: { results: [...] }
  if (Array.isArray(data?.results)) {
    for (const r of data.results) {
      results.push({
        name: r.name || r.description || r.prompt?.display || 'unnamed',
        pass: r.pass ?? r.success ?? false,
        score: r.score ?? (r.pass ? 1 : 0),
        duration: r.duration ?? 0,
        error: r.error ?? null,
        prompt: truncate(r.prompt?.raw || r.prompt || '', 200),
        response: truncate(r.response?.output || r.output || '', 200),
      });
    }
  }

  // Shape 2: { table: { head: [...], body: [...] } }
  if (data?.table?.body && Array.isArray(data.table.body)) {
    const head = data.table.head || [];
    const passIdx = head.findIndex((h) => /pass|success|result/i.test(h));
    const nameIdx = head.findIndex((h) => /name|test|description|prompt/i.test(h));
    const scoreIdx = head.findIndex((h) => /score/i.test(h));

    for (const row of data.table.body) {
      const passVal = passIdx >= 0 ? row[passIdx] : undefined;
      results.push({
        name: nameIdx >= 0 ? String(row[nameIdx] ?? 'unnamed') : 'unnamed',
        pass: passVal === true || passVal === 'true' || passVal === 'PASS',
        score: scoreIdx >= 0 ? Number(row[scoreIdx]) ?? (passVal ? 1 : 0) : passVal ? 1 : 0,
        duration: 0,
        error: null,
        prompt: '',
        response: '',
      });
    }
  }

  // Shape 3: top-level test outcomes (some promptfoo versions)
  if (!results.length && Array.isArray(data)) {
    for (const r of data) {
      results.push({
        name: r.name || r.description || 'unnamed',
        pass: r.pass ?? r.success ?? false,
        score: r.score ?? (r.pass ? 1 : 0),
        duration: r.duration ?? 0,
        error: r.error ?? null,
        prompt: truncate(r.prompt || '', 200),
        response: truncate(r.response || '', 200),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Red team result parsing
// ---------------------------------------------------------------------------
function extractRedTeamFindings(data) {
  const findings = [];

  // Shape 1: { findings: [...] }
  if (Array.isArray(data?.findings)) {
    for (const f of data.findings) {
      findings.push({
        plugin: f.plugin || f.category || 'unknown',
        test: f.test || f.description || 'unnamed',
        passed: f.passed ?? f.pass ?? false,
        severity: f.severity || 'medium',
        detail: f.detail || f.explanation || '',
        prompt: truncate(f.prompt || '', 200),
      });
    }
  }

  // Shape 2: { results: [...] } where results have plugin info
  if (Array.isArray(data?.results) && !findings.length) {
    for (const r of data.results) {
      if (r.plugin || r.category) {
        findings.push({
          plugin: r.plugin || r.category || 'unknown',
          test: r.name || r.description || 'unnamed',
          passed: r.passed ?? r.pass ?? false,
          severity: r.severity || 'medium',
          detail: r.detail || r.explanation || '',
          prompt: truncate(r.prompt || '', 200),
        });
      }
    }
  }

  // Shape 3: { plugins: { [name]: { ... } } }
  if (data?.plugins && typeof data.plugins === 'object' && !findings.length) {
    for (const [pluginName, pluginData] of Object.entries(data.plugins)) {
      const tests = pluginData.results || pluginData.tests || [];
      for (const t of tests) {
        findings.push({
          plugin: pluginName,
          test: t.name || t.description || 'unnamed',
          passed: t.passed ?? t.pass ?? false,
          severity: t.severity || 'medium',
          detail: t.detail || t.explanation || '',
          prompt: truncate(t.prompt || '', 200),
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
function computeStats(results) {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  const passRate = total > 0 ? passed / total : 0;
  const durations = results.map((r) => r.duration).filter((d) => d > 0);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  return { total, passed, failed, passRate, avgDuration };
}

/**
 * Build the full aggregated report from all result files.
 */
function buildReport(inputDir) {
  const files = collectResultFiles(inputDir);

  if (files.length === 0) {
    console.warn('[full-report] No result files found to process');
    return createEmptyReport();
  }

  console.log(`[full-report] Processing ${files.length} result files...`);

  const groups = {
    'eval-group-1': { tests: [] },
    'eval-group-2': { tests: [] },
    'eval-group-3': { tests: [] },
    'red-team': { findings: [] },
    unknown: { tests: [] },
  };

  for (const filePath of files) {
    const fileName = filePath.split('/').pop() || '';
    const group = classifyGroup(fileName);
    const data = loadJsonFile(filePath);
    if (!data) continue;

    if (group === 'red-team') {
      const findings = extractRedTeamFindings(data);
      groups['red-team'].findings.push(...findings);
      console.log(`  [red-team] ${filePath}: ${findings.length} findings`);
    } else {
      const tests = extractTestResults(data);
      groups[group].tests.push(...tests);
      console.log(`  [${group}] ${filePath}: ${tests.length} test results`);
    }
  }

  // Compute per-group stats
  const groupStats = {};
  for (const [groupName, groupData] of Object.entries(groups)) {
    if (groupName === 'red-team') {
      const findings = groupData.findings;
      const total = findings.length;
      const passed = findings.filter((f) => f.passed).length;
      const failed = total - passed;
      groupStats[groupName] = {
        type: 'red-team',
        total,
        passed,
        failed,
        passRate: total > 0 ? passed / total : 0,
        findings,
      };
    } else {
      const stats = computeStats(groupData.tests);
      groupStats[groupName] = {
        type: 'eval',
        ...stats,
        tests: groupData.tests,
      };
    }
  }

  // Overall stats (eval groups only, exclude red-team from main pass rate)
  const allEvalTests = [
    ...groups['eval-group-1'].tests,
    ...groups['eval-group-2'].tests,
    ...groups['eval-group-3'].tests,
  ];
  const overallEval = computeStats(allEvalTests);

  // Red team summary
  const allRedTeamFindings = groups['red-team'].findings;
  const redTeamPassed = allRedTeamFindings.filter((f) => f.passed).length;
  const redTeamPassRate = allRedTeamFindings.length > 0
    ? redTeamPassed / allRedTeamFindings.length
    : 0;

  // Categorize red team findings by severity
  const redTeamBySeverity = {};
  for (const f of allRedTeamFindings) {
    const sev = f.severity || 'unknown';
    if (!redTeamBySeverity[sev]) redTeamBySeverity[sev] = [];
    redTeamBySeverity[sev].push(f);
  }

  // Categorize red team findings by plugin
  const redTeamByPlugin = {};
  for (const f of allRedTeamFindings) {
    const plugin = f.plugin || 'unknown';
    if (!redTeamByPlugin[plugin]) redTeamByPlugin[plugin] = { total: 0, passed: 0, failed: 0 };
    redTeamByPlugin[plugin].total++;
    if (f.passed) redTeamByPlugin[plugin].passed++;
    else redTeamByPlugin[plugin].failed++;
  }

  // Build the report
  const report = {
    metadata: {
      generatedAt: new Date().toISOString(),
      reportVersion: '1.0.0',
      sha: process.env.GITHUB_SHA || 'unknown',
      runId: process.env.GITHUB_RUN_ID || 'unknown',
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1',
      workflow: process.env.GITHUB_WORKFLOW || 'Eval Full (Nightly)',
    },
    summary: {
      totalEvalTests: overallEval.total,
      passedEvalTests: overallEval.passed,
      failedEvalTests: overallEval.failed,
      evalPassRate: overallEval.passRate,
      avgTestDuration: overallEval.avgDuration,
      redTeamTotalFindings: allRedTeamFindings.length,
      redTeamPassedFindings: redTeamPassed,
      redTeamFailedFindings: allRedTeamFindings.length - redTeamPassed,
      redTeamPassRate,
      redTeamOverallPassed: redTeamPassRate >= 0.8,
    },
    groups: groupStats,
    redTeamSummary: {
      bySeverity: Object.fromEntries(
        Object.entries(redTeamBySeverity).map(([sev, findings]) => [
          sev,
          { count: findings.length, failed: findings.filter((f) => !f.passed).length },
        ])
      ),
      byPlugin: Object.fromEntries(
        Object.entries(redTeamByPlugin).map(([plugin, stats]) => [
          plugin,
          { ...stats, passRate: stats.total > 0 ? stats.passed / stats.total : 0 },
        ])
      ),
      passThreshold: 0.8,
    },
  };

  return report;
}

function createEmptyReport() {
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      reportVersion: '1.0.0',
      sha: process.env.GITHUB_SHA || 'unknown',
      runId: process.env.GITHUB_RUN_ID || 'unknown',
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1',
      workflow: process.env.GITHUB_WORKFLOW || 'Eval Full (Nightly)',
    },
    summary: {
      totalEvalTests: 0,
      passedEvalTests: 0,
      failedEvalTests: 0,
      evalPassRate: 0,
      avgTestDuration: 0,
      redTeamTotalFindings: 0,
      redTeamPassedFindings: 0,
      redTeamFailedFindings: 0,
      redTeamPassRate: 0,
      redTeamOverallPassed: false,
    },
    groups: {},
    redTeamSummary: { bySeverity: {}, byPlugin: {} },
  };
}

// ---------------------------------------------------------------------------
// Markdown report generation
// ---------------------------------------------------------------------------
function generateMarkdown(report) {
  const { metadata, summary, groups } = report;
  const lines = [];

  lines.push('# SYNTARO Nightly Eval Report');
  lines.push('');
  lines.push(`**Generated:** ${metadata.generatedAt}`);
  lines.push(`**SHA:** \`${metadata.sha}\``);
  lines.push(`**Run:** ${metadata.runId} (attempt ${metadata.runAttempt})`);
  lines.push(`**Workflow:** ${metadata.workflow}`);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Total Eval Tests | ${summary.totalEvalTests} |`);
  lines.push(`| Passed | ${summary.passedEvalTests} |`);
  lines.push(`| Failed | ${summary.failedEvalTests} |`);
  lines.push(`| Eval Pass Rate | ${(summary.evalPassRate * 100).toFixed(1)}% |`);
  lines.push(`| Avg Test Duration | ${summary.avgTestDuration.toFixed(1)}ms |`);
  lines.push(`| Red Team Findings | ${summary.redTeamTotalFindings} |`);
  lines.push(`| Red Team Passed | ${summary.redTeamPassedFindings} |`);
  lines.push(`| Red Team Pass Rate | ${(summary.redTeamPassRate * 100).toFixed(1)}% |`);
  lines.push(`| Red Team Threshold Met | ${summary.redTeamOverallPassed ? '✅ Yes' : '❌ No'} |`);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## Per-Group Results');
  lines.push('');

  for (const [groupName, stats] of Object.entries(groups)) {
    lines.push(`### ${groupName}`);
    lines.push('');
    if (stats.type === 'red-team') {
      lines.push(`| Metric | Value |`);
      lines.push('|---|---|');
      lines.push(`| Total Findings | ${stats.total} |`);
      lines.push(`| Passed | ${stats.passed} |`);
      lines.push(`| Failed | ${stats.failed} |`);
      lines.push(`| Pass Rate | ${(stats.passRate * 100).toFixed(1)}% |`);
      lines.push('');

      if (stats.findings && stats.findings.length > 0) {
        const failedFindings = stats.findings.filter((f) => !f.passed).slice(0, 20);
        if (failedFindings.length > 0) {
          lines.push('#### Failed Red Team Checks');
          lines.push('');
          lines.push('| Plugin | Test | Severity | Detail |');
          lines.push('|---|---|---|---|');
          for (const f of failedFindings) {
            lines.push(`| ${f.plugin} | ${f.test} | ${f.severity} | ${f.detail} |`);
          }
          if (failedFindings.length > 20) {
            lines.push(`| ... and ${failedFindings.length - 20} more |`);
          }
          lines.push('');
        }
      }
    } else {
      lines.push(`| Metric | Value |`);
      lines.push('|---|---|');
      lines.push(`| Total Tests | ${stats.total} |`);
      lines.push(`| Passed | ${stats.passed} |`);
      lines.push(`| Failed | ${stats.failed} |`);
      lines.push(`| Pass Rate | ${(stats.passRate * 100).toFixed(1)}% |`);
      lines.push(`| Avg Duration | ${stats.avgDuration.toFixed(1)}ms |`);
      lines.push('');

      if (stats.tests && stats.tests.length > 0) {
        const failedTests = stats.tests.filter((t) => !t.pass);
        if (failedTests.length > 0) {
          lines.push('#### Failed Tests');
          lines.push('');
          lines.push('| Test | Error |');
          lines.push('|---|---|');
          for (const t of failedTests) {
            lines.push(`| ${t.name} | ${t.error || '(no error)'} |`);
          }
          lines.push('');
        }
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('_Report generated by SYNTARO Eval Full workflow._');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();

  console.log(`[full-report] Input directory: ${opts.inputDir}`);
  console.log(`[full-report] Output file: ${opts.output}`);

  const report = buildReport(opts.inputDir);

  // Ensure output directory exists
  const outputDir = opts.output.substring(0, opts.output.lastIndexOf('/'));
  if (outputDir && !existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write JSON report
  writeFileSync(opts.output, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[full-report] JSON report written to ${opts.output}`);

  // Write Markdown report if requested
  if (opts.markdown) {
    const mdDir = opts.markdown.substring(0, opts.markdown.lastIndexOf('/'));
    if (mdDir && !existsSync(mdDir)) {
      mkdirSync(mdDir, { recursive: true });
    }
    const markdown = generateMarkdown(report);
    writeFileSync(opts.markdown, markdown, 'utf-8');
    console.log(`[full-report] Markdown report written to ${opts.markdown}`);
  }

  // Print summary to stdout
  const { summary } = report;
  console.log('');
  console.log('='.repeat(60));
  console.log('REPORT SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Eval Tests:    ${summary.passedEvalTests}/${summary.totalEvalTests} passed (${(summary.evalPassRate * 100).toFixed(1)}%)`);
  console.log(`  Red Team:      ${summary.redTeamPassedFindings}/${summary.redTeamTotalFindings} passed (${(summary.redTeamPassRate * 100).toFixed(1)}%)`);
  console.log(`  Red Team OK:   ${summary.redTeamOverallPassed ? 'YES' : 'NO (threshold: 80%)'}`);
  console.log('='.repeat(60));

  // Exit with non-zero if eval pass rate is 0 (but don't fail on empty data)
  if (summary.totalEvalTests > 0 && summary.evalPassRate === 0) {
    console.error('[full-report] All eval tests failed!');
    process.exit(1);
  }
}

main();
