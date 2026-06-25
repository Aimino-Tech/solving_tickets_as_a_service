/**
 * Malicious Code Detection Gate — scan diffs for dangerous patterns before PR.
 *
 * Scans git diffs for patterns that indicate malicious code: backdoors,
 * cryptominers, reverse shells, credential exfiltration, system tampering,
 * and CI/CD pipeline compromise.
 *
 * Usage:
 *   const result = scanDiff(diffContent);
 *   if (!result.safe) { /* block PR, post alert */ }
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'diff-scanner' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Finding {
  /** Machine-readable pattern identifier (kebab-case) */
  pattern: string;
  /** Human-readable description */
  description: string;
  /** Severity */
  severity: 'high' | 'medium' | 'low';
  /** Diff line number (1-based) */
  line: number;
  /** Truncated match text for context */
  match: string;
}

export interface ScanResult {
  /** true when no dangerous patterns are found */
  safe: boolean;
  /** All findings, sorted severity-desc then line-asc */
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Detection rules
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  /** Tested against full diff line including the '+' prefix */
  regex: RegExp;
}

const RULES: Rule[] = [
  // ═══ HIGH severity ═════════════════════════════════════════════════════

  // ── Base64-encoded executables ────────────────────────────────────────
  {
    id: 'base64-executable',
    description: 'Large base64 blob (>200 chars) — possible encoded executable',
    severity: 'high',
    regex: /^\+[^+].*[A-Za-z0-9+/]{200,}={0,2}$/,
  },

  // ── eval() with dynamic input ─────────────────────────────────────────
  {
    id: 'eval-dynamic',
    description: 'eval() with variable/expression — code injection risk',
    severity: 'high',
    regex: /^\+.*\beval\s*\(\s*(?!['"`])[^'")\s]/,
  },

  // ── execSync/spawn with shell=true or concatenation ────────────────────
  {
    id: 'unsafe-exec',
    description: 'execSync/exec/spawn with shell=true or concat — command injection risk',
    severity: 'high',
    regex: /^\+.*\b(exec(?:Sync)?|spawn)\s*\(.*\b(shell:\s*true|\+)/,
  },

  // ── Writes to /etc/ ───────────────────────────────────────────────────
  {
    id: 'write-etc',
    description: 'Writing to /etc/ — system config modification',
    severity: 'high',
    regex: /^\+.*["'`][^"'`]*\/etc\//,
  },

  // ── Writes to /usr/ (excluding benign paths) ──────────────────────────
  {
    id: 'write-usr',
    description: 'Writing to /usr/ — system binary/library modification',
    severity: 'high',
    regex: /^\+.*["'`][^"'`]*\/usr\/(?!share\/|local\/share\/|lib\/python|local\/lib\/python)/,
  },

  // ── Writes to /root/ ──────────────────────────────────────────────────
  {
    id: 'write-root',
    description: 'Writing to /root/ — root home modification',
    severity: 'high',
    regex: /^\+.*["'`][^"'`]*\/root\//,
  },

  // ── Crypto miners ─────────────────────────────────────────────────────
  {
    id: 'crypto-miner',
    description: 'Cryptominer reference — pool/stratum/wallet/miner binary',
    severity: 'high',
    regex: /^\+.*(?:miningpool|stratum[\s+]|xmr[\s+]|monero|ethash|cryptonight|cpuminer|ccminer|xmrig|minerd)/i,
  },

  // ── Reverse shells ────────────────────────────────────────────────────
  {
    id: 'reverse-shell',
    description: 'Reverse shell pattern — possible backdoor',
    severity: 'high',
    regex: /^\+.*(?:(?:bash|sh)\s+-i\s*[>&]|nc\s+-e\s+\/|ncat\s+-e\s+\/|revshell|reverse[\s_]*shell|\/dev\/tcp\/[0-9]|mkfifo\s+\/tmp|python\s+-c\s+['"]import\s+(?:pty|socket)|powershell\s+.*-e\s+[A-Za-z0-9+/]{50,})/i,
  },

  // ── Env var exfiltration ──────────────────────────────────────────────
  {
    id: 'env-exfil',
    description: 'Env vars sent to external URL — possible exfiltration',
    severity: 'high',
    regex: /^\+.*(?:process\.env|os\.environ|getenv|env\[).*(?:curl|wget|fetch|request|axios|https?:\/\/)/i,
  },

  // ── CI config modification ────────────────────────────────────────────
  {
    id: 'ci-config-mod',
    description: 'CI/CD config modification — possible pipeline tampering',
    severity: 'high',
    regex: /^\+.*["'`][^"'`]*(?:\.github\/workflows|\.gitlab-ci\.yml|\.circleci\/|Jenkinsfile|\.drone\.yml|\.woodpecker\/)/,
  },

  // ── SSH key writes ────────────────────────────────────────────────────
  {
    id: 'ssh-key-write',
    description: 'Writing SSH keys — credential backdoor',
    severity: 'high',
    regex: /^\+.*(?:authorized_keys|id_rsa\b|id_ed25519\b|id_ecdsa\b|ssh-add\s|chmod\s+0[46]00\s+.*ssh)/i,
  },

  // ── child_process exec with variable ──────────────────────────────────
  {
    id: 'child-process-exec',
    description: 'child_process.exec with variable arg — command injection',
    severity: 'high',
    regex: /^\+.*\bchild_process\b.*\bexec\b\s*\([^)]*\$/,
  },

  // ═══ MEDIUM severity ═══════════════════════════════════════════════════

  {
    id: 'function-constructor',
    description: 'Function() with non-literal arg — eval-like injection',
    severity: 'medium',
    regex: /^\+.*\bnew\s+Function\s*\(\s*(?!['"`])/,
  },

  {
    id: 'set-timeout-string',
    description: 'setTimeout/setInterval with string — eval-like',
    severity: 'medium',
    regex: /^\+.*\b(setTimeout|setInterval)\s*\(\s*['"`]/,
  },
];

// ---------------------------------------------------------------------------
// scanDiff
// ---------------------------------------------------------------------------

/**
 * Scan a raw git diff for dangerous patterns.
 *
 * @param diff - Raw unified diff output
 * @returns ScanResult with safe flag and array of findings
 */
export function scanDiff(diff: string): ScanResult {
  const findings: Finding[] = [];

  if (!diff || diff.trim().length === 0) {
    return { safe: true, findings: [] };
  }

  const lines = diff.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Only scan added lines; removed lines don't introduce code
    if (!line.startsWith('+')) continue;
    // Skip diff metadata
    if (line.startsWith('+++') || line.startsWith('@@')) continue;

    for (const rule of RULES) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(line)) {
        findings.push({
          pattern: rule.id,
          description: rule.description,
          severity: rule.severity,
          line: i + 1,
          match: line.replace(/^\+/, '').trim().substring(0, 120),
        });
      }
    }
  }

  // Deduplicate by pattern id
  const seen = new Set<string>();
  const unique: Finding[] = [];
  for (const f of findings) {
    const key = f.pattern;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(f);
    }
  }

  // Sort: high first, then by line
  const rank = { high: 0, medium: 1, low: 2 };
  unique.sort((a, b) => {
    const d = rank[a.severity] - rank[b.severity];
    return d !== 0 ? d : a.line - b.line;
  });

  const safe = unique.length === 0;

  if (!safe) {
    log.warn(
      { count: unique.length, patterns: unique.map((f) => f.pattern) },
      'Malicious code patterns detected — gate blocked',
    );
  } else {
    log.info('Diff scan passed — no dangerous patterns');
  }

  return { safe, findings: unique };
}

// ---------------------------------------------------------------------------
// buildSecurityAlertMessage
// ---------------------------------------------------------------------------

/**
 * Build a formatted GitHub Markdown comment from scan findings.
 */
export function buildSecurityAlertMessage(findings: Finding[]): string {
  const rows = findings.map((f) => {
    const icon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟡' : '🔵';
    const match = f.match.length > 80 ? f.match.slice(0, 80) + '…' : f.match;
    return `| ${icon} ${f.severity} L${f.line} | \`${f.pattern}\` | ${f.description} | \`${match}\` |`;
  });

  return [
    '### 🚨 Security Alert — Malicious Code Detected',
    '',
    'The fix contains potentially dangerous code. The PR has been **blocked**.',
    '',
    '| Severity | Pattern | Description | Match |',
    '|---|---|---|---|',
    ...rows,
    '',
    'The branch was pushed but **no PR was created**. Review the changes manually.',
    '',
    '_Malicious Code Detection Gate_',
  ].join('\n');
}
