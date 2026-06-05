/**
 * CI Failure Analyzer — parses CI log output to determine the root cause
 * of a failure (compilation error, test failure, lint issue, etc.).
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ All parsing is best-effort; failures return a generic message
 * ✅ Truncated logs are handled gracefully
 * ✅ No external dependencies beyond the Node.js standard library
 * ────────────────────────────────────────────────────────────────────
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'ci-analyzer' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailureCategory = 'compilation' | 'test_failure' | 'lint' | 'timeout' | 'infrastructure' | 'unknown';

export interface FailureAnalysis {
  category: FailureCategory;
  summary: string;
  details: string[];
  /** Snippet of the most relevant error (up to 2000 chars) */
  errorSnippet: string;
  /** Confidence in the analysis (0-1) */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze CI log output and return a structured failure analysis.
 *
 * @param checkName - The name of the check run (e.g. "CI / build")
 * @param logs - The raw log output from the CI run
 * @returns A structured FailureAnalysis
 */
export function analyzeFailure(checkName: string, logs: string): string {
  try {
    const analysis = parseLogs(checkName, logs);

    const parts: string[] = [
      `**Category**: ${analysis.category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`,
      ``,
      `**Summary**: ${analysis.summary}`,
      ``,
    ];

    if (analysis.details.length > 0) {
      parts.push('**Details**:');
      parts.push(...analysis.details.map((d) => `- ${d}`));
      parts.push('');
    }

    if (analysis.errorSnippet) {
      parts.push('<details><summary>Error Snippet</summary>');
      parts.push('');
      parts.push('```');
      parts.push(analysis.errorSnippet);
      parts.push('```');
      parts.push('</details>');
    }

    return parts.join('\n');
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to analyze CI logs');
    return `The **${checkName}** check failed. Check the workflow run for details.`;
  }
}

/**
 * Parse raw log content and return a structured analysis.
 * Exported for testing.
 */
export function parseLogs(checkName: string, logs: string): FailureAnalysis {
  const lines = logs.split('\n');
  const errorLines: string[] = [];
  const details: string[] = [];

  let category: FailureCategory = 'unknown';
  let summary = `The check "${checkName}" failed.`;
  let confidence = 0.3;

  // Collect error lines
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes('error') ||
      lower.includes('failed') ||
      lower.includes('failure') ||
      lower.includes('fatal') ||
      lower.includes('abort') ||
      lower.includes('timeout') ||
      lower.includes('exception') ||
      lower.includes('traceback') ||
      lower.includes('exit code')
    ) {
      errorLines.push(line);
    }
  }

  // Detect compilation errors (TypeScript, C++, Rust, Java, Go, etc.)
  const compilationPatterns = [
    /error\s*TS\d{1,6}/i,           // TypeScript
    /ts\w{1,5}\s*\(?\d+,\d+\)?/,     // TypeScript
    /error:\s*['\w\/.-]+\.\w+:/i,     // General compiler: file.ext:line:col
    /fatal\s+error/i,                 // Fatal error
    /error\s*C\d{4,6}/i,             // C++ / MSVC
    /cannot\s+find\s+(name|module)/i, // TypeScript / JavaScript
    /compilation\s+error/i,
    /compile\s+error/i,
    /build\s+failed/i,
    /Module\s+not\s+found/i,
    /unexpected\s+token/i,
    /is\s+not\s+a\s+function/i,
    /cannot\s+read\s+property/i,
    /syntax\s+error/i,
  ];

  // Detect test failures
  const testPatterns = [
    /tests?\s+failed/i,
    /test\s+suite\s+failed/i,
    /\d+\s+failing/i,
    /\d+\s+failed\s*[,.]/i,
    /FAIL\s+/,
    /✗\s+/,
    /×\s+/,
    /expect\(/i,
    /assertion\s+error/i,
    /assert\.\w+/i,
    /test.*fail/i,
    /failed:\s*\d+/i,
    /not\s+ok\s+\d+/i,
  ];

  // Detect lint issues
  const lintPatterns = [
    /lint(ing)?\s+error/i,
    /eslint/i,
    /biome/i,
    /prettier/i,
    /stylelint/i,
    /tslint/i,
    /linter\s+failed/i,
    /lint\s+failure/i,
    /\d+\s+problem/i,
    /\d+\s+warning/i,
  ];

  // Detect timeouts
  const timeoutPatterns = [
    /timeout/i,
    /timed?\s*out/i,
    /exceeded.*(time|limit)/i,
    /too\s+long/i,
    /abort/i,
    /terminat/i,
  ];

  // Detect infrastructure issues
  const infraPatterns = [
    /cannot\s+connect/i,
    /connection\s+(refused|timed?\s*out|reset)/i,
    /network\s+error/i,
    /500\s+/,
    /502\s+/,
    /503\s+/,
    /rate\s+limit/i,
    /no\s+space/i,
    /disk\s+(full|quota)/i,
    /out\s+of\s+memory/i,
    /oom\s+killed/i,
    /killed/i,
    /docker/i,
    /container/i,
    /registry/i,
    /authentication\s+failed/i,
    /permission\s+denied/i,
    /econnrefused/i,
    /etimedout/i,
    /enospc/i,
  ];

  // Score each category
  let compilationScore = 0;
  let testScore = 0;
  let lintScore = 0;
  let timeoutScore = 0;
  let infraScore = 0;

  for (const line of errorLines) {
    for (const p of compilationPatterns) {
      if (p.test(line)) compilationScore += 2;
    }
    for (const p of testPatterns) {
      if (p.test(line)) testScore += 2;
    }
    for (const p of lintPatterns) {
      if (p.test(line)) lintScore += 3;
    }
    for (const p of timeoutPatterns) {
      if (p.test(line)) timeoutScore += 2;
    }
    for (const p of infraPatterns) {
      if (p.test(line)) infraScore += 2;
    }
  }

  // Determine category by highest score
  const scores: Array<{ category: FailureCategory; score: number }> = [
    { category: 'compilation', score: compilationScore },
    { category: 'test_failure', score: testScore },
    { category: 'lint', score: lintScore },
    { category: 'timeout', score: timeoutScore },
    { category: 'infrastructure', score: infraScore },
  ];

  scores.sort((a, b) => b.score - a.score);
  category = scores[0].score > 0 ? scores[0].category : 'unknown';
  confidence = Math.min(1, scores[0].score / 10);

  // Build summary based on category
  switch (category) {
    case 'compilation': {
      const tsErrors = errorLines.filter((l) => /error\s*TS\d{1,6}/i.test(l));
      if (tsErrors.length > 0) {
        summary = `Compilation failed with ${tsErrors.length} TypeScript error(s).`;
        details.push(`${tsErrors.length} TypeScript error(s) detected`);
      } else {
        summary = `Compilation failed with ${errorLines.length} error(s).`;
        details.push(`${errorLines.length} compilation error(s) detected`);
      }

      // Extract file paths and line numbers from errors
      const fileErrors = errorLines
        .filter((l) => /\.\w+:\d+:\d+/.test(l))
        .slice(0, 5);
      if (fileErrors.length > 0) {
        details.push('Sample errors:');
        for (const fe of fileErrors) {
          const match = fe.match(/([\w\/.-]+\.[a-z]+(?:\(\d+,\d+\))?)/i);
          if (match) {
            details.push(`- ${match[1]}`);
          }
        }
      }
      break;
    }

    case 'test_failure': {
      // Try to extract test count
      const failCountMatch = logs.match(/(\d+)\s+(failed|failing)/i);
      const failCount = failCountMatch ? parseInt(failCountMatch[1], 10) : errorLines.length;
      summary = `Test suite failed with ${failCount} failing test(s).`;
      details.push(`Approximately ${failCount} test failure(s) detected`);

      // Extract failing test names
      const failingTests = extractFailingTests(errorLines);
      if (failingTests.length > 0) {
        details.push('Failing tests:');
        for (const ft of failingTests.slice(0, 10)) {
          details.push(`- \`${ft}\``);
        }
      }
      break;
    }

    case 'lint': {
      const problemCount = logs.match(/(\d+)\s+problem/i);
      const warningCount = logs.match(/(\d+)\s+warning/i);
      summary = `Linting failed${problemCount ? ` (${problemCount[1]} problem(s))` : ''}${warningCount ? ` (${warningCount[1]} warning(s))` : ''}.`;
      details.push('Linting errors detected — check the workflow run for details.');
      break;
    }

    case 'timeout': {
      summary = 'The CI run timed out.';
      details.push('The workflow exceeded its time limit.');
      details.push('Consider optimizing the build/tests or increasing the timeout.');
      break;
    }

    case 'infrastructure': {
      if (logs.match(/oom|out of memory|killed/i)) {
        summary = 'The CI runner ran out of memory.';
        details.push('OOM kill detected — the runner may need more memory.');
      } else if (logs.match(/disk|no space/i)) {
        summary = 'The CI runner ran out of disk space.';
        details.push('Disk full — consider cleaning up cache or increasing disk size.');
      } else if (logs.match(/connection|network/i)) {
        summary = 'A network error occurred during CI.';
        details.push('Network connectivity issue detected — may be transient.');
      } else if (logs.match(/rate limit/i)) {
        summary = 'API rate limit exceeded during CI.';
        details.push('Rate limited — consider using authenticated API calls.');
      } else {
        summary = 'An infrastructure error occurred during CI.';
        details.push('Infrastructure issue detected — may be a transient runner problem.');
      }
      break;
    }

    default: {
      summary = `The check "${checkName}" failed with an unknown error.`;
      details.push('Could not determine the failure category from the log output.');
      break;
    }
  }

  // Build error snippet
  const snippet = buildErrorSnippet(lines, errorLines);

  return {
    category,
    summary,
    details,
    errorSnippet: snippet,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract failing test names from error lines.
 */
function extractFailingTests(errorLines: string[]): string[] {
  const tests: string[] = [];

  // Common test failure patterns
  for (const line of errorLines) {
    // Mocha / Jest: "1) test name"
    const mochaMatch = line.match(/^\s*\d+[\)\.]\s+(.*)/);
    if (mochaMatch) {
      tests.push(mochaMatch[1].trim());
      continue;
    }

    // Vitest: "FAIL  test/file.test.ts > test name"
    const vitestMatch = line.match(/>\s+(.+)$/);
    if (vitestMatch && !vitestMatch[1].includes('module')) {
      tests.push(vitestMatch[1].trim());
      continue;
    }

    // Go test: "--- FAIL: TestName"
    const goMatch = line.match(/---\s+FAIL:\s+(.+)/);
    if (goMatch) {
      tests.push(goMatch[1].trim());
      continue;
    }

    // Pytest: "FAILED test_file.py::test_name"
    const pyMatch = line.match(/FAILED\s+([\w\/_.-]+::[\w_]+)/);
    if (pyMatch) {
      tests.push(pyMatch[1].trim());
      continue;
    }

    // Generic: lines containing "fail" with a test identifier
    const genericMatch = line.match(/['"]?([\w\/_.-]+(?:test|spec|test_|_test)[\w\/_.-]*)['"]?/i);
    if (genericMatch && (line.includes('fail') || line.includes('FAIL'))) {
      tests.push(genericMatch[1].trim());
    }
  }

  return [...new Set(tests)].slice(0, 10);
}

/**
 * Build a concise error snippet from the log lines.
 */
function buildErrorSnippet(allLines: string[], errorLines: string[]): string {
  if (errorLines.length === 0) return '';

  // Try to find a dense block of errors
  const errorIndices = new Set<number>();
  for (let i = 0; i < allLines.length; i++) {
    const lower = allLines[i].toLowerCase();
    if (
      lower.includes('error') ||
      lower.includes('failed') ||
      lower.includes('failure') ||
      lower.includes('fatal') ||
      lower.includes('traceback') ||
      lower.includes('exception')
    ) {
      // Include context lines around this
      for (let j = Math.max(0, i - 2); j <= Math.min(allLines.length - 1, i + 5); j++) {
        errorIndices.add(j);
      }
    }
  }

  if (errorIndices.size === 0) {
    return errorLines.slice(0, 15).join('\n').slice(0, 2000);
  }

  const sorted = [...errorIndices].sort((a, b) => a - b);
  const snippetLines: string[] = [];
  let lastIdx = -1;

  for (const idx of sorted) {
    if (lastIdx !== -1 && idx - lastIdx > 2) {
      snippetLines.push('...');
    }
    snippetLines.push(allLines[idx]);
    lastIdx = idx;
  }

  return snippetLines.join('\n').slice(0, 2000);
}
