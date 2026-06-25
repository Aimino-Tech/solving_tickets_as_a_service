/**
 * Diff Scanner — pattern detection engine for agent-generated diffs.
 *
 * Scans git diff output for dangerous patterns before PR creation.
 * Pattern categories: HIGH (secrets, code execution, crypto miners),
 * MEDIUM (obfuscation), LOW (commented-out code, large binary blobs).
 */

import { rootLogger } from '../utils/logger.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const log = rootLogger.child({ module: 'diff-scanner' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FindingSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ScanResult {
  severity: FindingSeverity;
  type: string;
  file: string;
  line: number;
  message: string;
  pattern?: string;
}

// ---------------------------------------------------------------------------
// False-positive pattern loading
// ---------------------------------------------------------------------------

let _falsePositivePatterns: RegExp[] | null = null;

/**
 * Load false-positive suppression patterns from .trufflehogignore.
 */
export function loadFalsePositivePatterns(projectRoot?: string): RegExp[] {
  if (_falsePositivePatterns) return _falsePositivePatterns ?? [];

  const ignorePath = projectRoot
    ? resolve(projectRoot, '.trufflehogignore')
    : resolve(process.cwd(), '.trufflehogignore');

  if (!existsSync(ignorePath)) {
    _falsePositivePatterns = [];
    return _falsePositivePatterns ?? [];
  }

  try {
    const content = readFileSync(ignorePath, 'utf8');
    _falsePositivePatterns = content
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.startsWith('#'))
      .map((line: string) => {
        try {
          return new RegExp(line, 'i');
        } catch {
          log.warn({ pattern: line }, 'Invalid regex in .trufflehogignore, skipping');
          return null;
        }
      })
      .filter((r: RegExp | null): r is RegExp => r !== null);
    log.info({ patternCount: (_falsePositivePatterns as RegExp[]).length }, 'Loaded false-positive suppression patterns');
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to read .trufflehogignore');
    _falsePositivePatterns = [];
  }

  return _falsePositivePatterns ?? [];
}

/**
 * Reset loaded false-positive patterns (useful for tests).
 */
export function resetFalsePositivePatterns(): void {
  _falsePositivePatterns = null;
}

function isFalsePositive(matchText: string): boolean {
  const patterns = loadFalsePositivePatterns();
  // Patterns must match the ENTIRE match text to be considered false positive
  return patterns.some((p) => {
    const anchored = new RegExp(`^${p.source}$`, p.flags);
    return anchored.test(matchText);
  });
}

// ---------------------------------------------------------------------------
// Pattern Definitions
// ---------------------------------------------------------------------------

interface PatternDef {
  severity: FindingSeverity;
  type: string;
  regex: RegExp;
  message: string;
}

export const PATTERNS: PatternDef[] = [
  // ── HIGH: Secrets & Credentials ──────────────────────────────────────
  {
    severity: 'HIGH',
    type: 'api-key',
    regex: /(?:sk-[a-zA-Z0-9]{20,}|pk-[a-zA-Z0-9]{20,}|[A-Za-z0-9]{32,})/g,
    message: 'Possible API key or secret token detected',
  },
  {
    severity: 'HIGH',
    type: 'private-key',
    regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    message: 'Private key detected in diff',
  },
  {
    severity: 'HIGH',
    type: 'connection-string',
    regex: /(?:mongodb|postgresql|mysql|redshift):\/\/[^\s"']+/gi,
    message: 'Database connection string detected',
  },
  {
    severity: 'HIGH',
    type: 'password',
    regex: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']+["']/gi,
    message: 'Hardcoded password detected',
  },
  {
    severity: 'HIGH',
    type: 'aws-key',
    regex: /(?:AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})/g,
    message: 'AWS access key ID detected',
  },
  {
    severity: 'HIGH',
    type: 'github-token',
    regex: /(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{36,}/g,
    message: 'GitHub token detected',
  },
  {
    severity: 'HIGH',
    type: 'slack-token',
    regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/g,
    message: 'Slack token detected',
  },
  {
    severity: 'HIGH',
    type: 'jwt-token',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    message: 'JWT token detected',
  },

  // ── HIGH: Dangerous Code Execution ───────────────────────────────────
  {
    severity: 'HIGH',
    type: 'code-execution',
    regex: /(?:^|[^a-zA-Z])(?:os\.system|subprocess\.call|subprocess\.popen|child_process\.exec|execSync)\s*\(/g,
    message: 'Dangerous code execution function detected',
  },
  {
    severity: 'HIGH',
    type: 'eval-usage',
    regex: /(?:^|[^a-zA-Z])(?:eval|Function\(|setTimeout|setInterval)\s*\(\s*["'`]/g,
    message: 'eval() or dynamic code execution detected',
  },
  {
    severity: 'HIGH',
    type: 'dangerous-import',
    regex: /(?:^import\s+os\s*$|^from\s+os\s+import|import\s+subprocess|import\s+pty|import\s+paramiko)/gm,
    message: 'Dangerous module import detected (os, subprocess, pty, paramiko)',
  },
  {
    severity: 'HIGH',
    type: 'dangerous-node-module',
    regex: /require\(['"](?:child_process|cluster|vm|worker_threads)['"]\)/g,
    message: 'Dangerous Node.js module required',
  },

  // ── HIGH: Crypto Miners & Suspicious Network Calls ───────────────────
  {
    severity: 'HIGH',
    type: 'crypto-miner',
    regex: /(?:cryptonight|cryptoloot|coinhive|miner|crypto-miner|cryptocurrency-mining)/gi,
    message: 'Crypto miner reference detected',
  },
  {
    severity: 'HIGH',
    type: 'suspicious-url',
    regex: /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\/(?:[a-z]*\.(?:js|py|exe|sh|bin|dll))?/gi,
    message: 'Suspicious network call to IP-based URL detected',
  },
  {
    severity: 'HIGH',
    type: 'suspicious-domain',
    regex: /https?:\/\/(?:[a-z0-9-]+\.)*(?:xyz|top|gq|ml|cf|tk|ga|bid)\/[^\s"')]*/gi,
    message: 'Suspicious domain detected (suspicious TLD)',
  },
  {
    severity: 'HIGH',
    type: 'webhook-exfiltration',
    regex: /https?:\/\/webhook\.site\/[^\s"')]+/gi,
    message: 'Potential webhook exfiltration endpoint detected',
  },

  // ── MEDIUM: Obfuscated Code ──────────────────────────────────────────
  {
    severity: 'MEDIUM',
    type: 'base64-encoded',
    regex: /["'`][A-Za-z0-9+/]{40,}={0,2}["'`]/g,
    message: 'Possible base64-encoded payload detected',
  },
  {
    severity: 'MEDIUM',
    type: 'hex-encoded',
    regex: /["'`]\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2,}/g,
    message: 'Hex-encoded string detected',
  },
  {
    severity: 'MEDIUM',
    type: 'obfuscated-string',
    regex: /(?:fromCharCode|charCodeAt|split\(['"]{2}['"]\)\.join|unescape)/gi,
    message: 'Obfuscated JavaScript string detected',
  },

  // ── LOW: Commented-out Code ──────────────────────────────────────────
  {
    severity: 'LOW',
    type: 'commented-code',
    regex: /^\s*\/\/\s*(?:import |export |function |class |const |let |var )/gm,
    message: 'Commented-out code detected',
  },

  // ── LOW: Large Binary Blobs ──────────────────────────────────────────
  {
    severity: 'LOW',
    type: 'binary-blob',
    regex: /["'`][A-Za-z0-9+/]{200,}={0,2}["'`]/g,
    message: 'Large blob detected (possible binary/packed data)',
  },
];

// ---------------------------------------------------------------------------
// Diff Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a unified diff string into per-file hunks with line numbers.
 */
export function parseDiff(diff: string): Array<{ file: string; startLine: number; content: string }> {
  const hunks: Array<{ file: string; startLine: number; content: string }> = [];
  let currentFile = '';
  let currentStartLine = 0;
  let currentLines: string[] = [];
  let inHunk = false;

  const lines = diff.split('\n');

  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (fileMatch) {
      if (inHunk && currentLines.length > 0) {
        hunks.push({ file: currentFile, startLine: currentStartLine, content: currentLines.join('\n') });
      }
      currentFile = fileMatch[2];
      currentLines = [];
      inHunk = false;
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      if (inHunk && currentLines.length > 0) {
        hunks.push({ file: currentFile, startLine: currentStartLine, content: currentLines.join('\n') });
      }
      currentStartLine = parseInt(hunkMatch[1], 10);
      currentLines = [];
      inHunk = true;
      continue;
    }

    if (inHunk && currentFile) {
      if (line.startsWith('+') || line.startsWith(' ')) {
        currentLines.push(line);
      }
    }
  }

  if (inHunk && currentLines.length > 0) {
    hunks.push({ file: currentFile, startLine: currentStartLine, content: currentLines.join('\n') });
  }

  return hunks;
}

// ---------------------------------------------------------------------------
// Main scan function
// ---------------------------------------------------------------------------

/**
 * Scan a git diff string for dangerous patterns.
 */
export function scanDiff(diff: string, projectRoot?: string): ScanResult[] {
  if (!diff || diff.trim().length === 0) {
    return [];
  }

  if (projectRoot) {
    _falsePositivePatterns = null;
    loadFalsePositivePatterns(projectRoot);
  }

  const results: ScanResult[] = [];
  const hunks = parseDiff(diff);

  for (const hunk of hunks) {
    const lines = hunk.content.split('\n');
    let lineNumber = hunk.startLine;

    for (const line of lines) {
      const isAdded = line.startsWith('+');
      const content = isAdded ? line.slice(1) : line;

      if (isFalsePositive(content)) continue;

      for (const pattern of PATTERNS) {
        pattern.regex.lastIndex = 0;
        const matches = content.matchAll(pattern.regex);
        for (const match of matches) {
          results.push({
            severity: pattern.severity,
            type: pattern.type,
            file: hunk.file,
            line: lineNumber,
            message: pattern.message,
            pattern: match[0].length > 80 ? match[0].slice(0, 80) + '...' : match[0],
          });
        }
      }

      if (isAdded) {
        lineNumber++;
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped: ScanResult[] = [];
  for (const result of results) {
    const key = `${result.file}:${result.type}:${result.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  }

  return deduped;
}

/**
 * Check if any scan results would block a PR (contains HIGH severity findings).
 */
export function hasBlockingFindings(results: ScanResult[]): boolean {
  return results.some((r) => r.severity === 'HIGH');
}

/**
 * Group scan results by severity.
 */
export function groupBySeverity(results: ScanResult[]): Record<FindingSeverity, ScanResult[]> {
  return {
    HIGH: results.filter((r) => r.severity === 'HIGH'),
    MEDIUM: results.filter((r) => r.severity === 'MEDIUM'),
    LOW: results.filter((r) => r.severity === 'LOW'),
  };
}
