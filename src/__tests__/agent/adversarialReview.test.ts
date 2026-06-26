import { describe, expect, it } from 'vitest';

import {
  generateAdversarialInputs,
  layer1InputFuzzing,
  scanAgentOutput,
  layer3ConsistencyCheck,
  runAdversarialReview,
} from '../../agent/adversarialReview.js';

// ── Test data ─────────────────────────────────────────────────────────────────

const SAMPLE_ISSUE_TITLE = 'Fix authentication token validation in src/auth/tokens.ts';
const SAMPLE_ISSUE_BODY = `
The JWT token validation in \`src/auth/tokens.ts\` does not properly verify expiration dates.
This causes expired tokens to be accepted. Steps to reproduce:
1. Generate a token with expiry = 0
2. Use it in a request
3. Server accepts it

Expected: expired tokens should be rejected with 401.
`;

const SAMPLE_AGENT_OUTPUT = `
## Investigation

The issue is in the verifyToken function in src/auth/tokens.ts.
The expiry check uses > instead of >=, allowing zero-expiry tokens through.

## Fix

Changed condition from expiresAt > now to expiresAt >= now in the validation.

## Files Changed

- Modified src/auth/tokens.ts
- Added regression test in src/__tests__/auth/tokens.test.ts

## Test Results

All tests pass. The regression test verifies that a token with expiry=0 is rejected.
`;

const SAMPLE_DIFF = `diff --git a/src/auth/tokens.ts b/src/auth/tokens.ts
index abc..def 100644
--- a/src/auth/tokens.ts
+++ b/src/auth/tokens.ts
@@ -42,7 +42,7 @@ function verifyToken(token: string): TokenPayload {
   const now = Date.now() / 1000;
-  if (expiresAt > now) {
+  if (expiresAt >= now) {
     return payload;
   }
   throw new Error('Token expired');
diff --git a/src/__tests__/auth/tokens.test.ts b/src/__tests__/auth/tokens.test.ts
new file mode 100644
index 000..abc 100644
--- /dev/null
+++ b/src/__tests__/auth/tokens.test.ts
@@ -0,0 +1,20 @@
+import { describe, it, expect } from 'vitest';
+import { verifyToken } from '../../auth/tokens.js';
+
+describe('verifyToken', () => {
+  it('rejects token with expiry = 0', () => {
+    expect(() => verifyToken('eyJ.eyJleHAiOjB9.sig')).toThrow('Token expired');
+  });
+
+  it('accepts valid token', () => {
+    const jwtValue = 'eyJ.eyJleHAiOjk5OTk5OTk5OTl9.sig';
+    const result = verifyToken(jwtValue);
+    expect(result).toBeDefined();
+  });
+});
`;

const UNSAFE_AGENT_OUTPUT = `
## Investigation

Found the bug in the login endpoint. The password comparison was using loose equality.
Fixed by adding:

\`\`\`js
const password = req.body.password;
const query = 'SELECT * FROM users WHERE password = ' + password;
db.exec(query);
\`\`\`

This should fix the login issue.
`;

const UNSAFE_DIFF = `diff --git a/src/login.ts b/src/login.ts
index abc..def 100644
--- a/src/login.ts
+++ b/src/login.ts
@@ -10,7 +10,7 @@
-  const result = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
+  const password = req.body.password;
+  const query = 'SELECT * FROM users WHERE password = ' + password;
+  exec(query);
`;

// ── Layer 1: Input Fuzzing ────────────────────────────────────────────────────

describe('Layer 1 — Input Fuzzing', () => {
  describe('generateAdversarialInputs', () => {
    it('generates inputs from issue context', () => {
      const inputs = generateAdversarialInputs(SAMPLE_ISSUE_TITLE, SAMPLE_ISSUE_BODY);
      expect(inputs.length).toBeGreaterThan(0);
    });

    it('generates all four input types', () => {
      const inputs = generateAdversarialInputs('Test', 'Some issue body');
      const types = new Set(inputs.map(i => i.type));
      expect(types.has('prompt-injection')).toBe(true);
      expect(types.has('malformed-input')).toBe(true);
      expect(types.has('edge-case')).toBe(true);
      expect(types.has('boundary-condition')).toBe(true);
    });

    it('includes prompt injection inputs', () => {
      const inputs = generateAdversarialInputs('Test', 'Body');
      const injections = inputs.filter(i => i.type === 'prompt-injection');
      expect(injections.length).toBeGreaterThan(0);
      expect(injections.some(i => i.input.includes('Ignore all previous instructions'))).toBe(true);
      expect(injections.some(i => i.input.includes('System:'))).toBe(true);
      expect(injections.some(i => i.input.includes('ENDRESPONSE'))).toBe(true);
    });

    it('includes SQL injection and path traversal', () => {
      const inputs = generateAdversarialInputs('Test', 'Body');
      const malformed = inputs.filter(i => i.type === 'malformed-input');
      expect(malformed.some(i => i.input.includes('DROP TABLE'))).toBe(true);
      expect(malformed.some(i => i.input.includes('../../../etc/passwd'))).toBe(true);
    });

    it('includes prototype pollution input', () => {
      const inputs = generateAdversarialInputs('Test', 'Body');
      expect(inputs.some(i => i.input.includes('__proto__'))).toBe(true);
    });

    it('includes edge cases (empty, null, undefined)', () => {
      const inputs = generateAdversarialInputs('Test', 'Body');
      const edgeCases = inputs.filter(i => i.type === 'edge-case');
      expect(edgeCases.some(i => i.input === '')).toBe(true);
      expect(edgeCases.some(i => i.input === 'null')).toBe(true);
      expect(edgeCases.some(i => i.input === 'undefined')).toBe(true);
    });

    it('generates context-specific boundary conditions from issue terms', () => {
      const inputs = generateAdversarialInputs('Fix authentication bug', 'token validation issue with expiry check');
      const boundaries = inputs.filter(i => i.type === 'boundary-condition');
      expect(boundaries.length).toBeGreaterThan(0);
    });

    it('each input has a description', () => {
      const inputs = generateAdversarialInputs('Test', 'Body');
      for (const input of inputs) {
        expect(input.description).toBeTruthy();
        expect(typeof input.input).toBe('string');
      }
    });

    it('generates inputs referencing file paths from issue', () => {
      const inputs = generateAdversarialInputs('Fix src/auth/tokens.ts', 'The issue is in `src/auth/tokens.ts`');
      expect(inputs.length).toBeGreaterThan(5);
    });

    it('handles empty title and body gracefully', () => {
      const inputs = generateAdversarialInputs('', '');
      expect(inputs.length).toBeGreaterThan(0);
    });
  });

  describe('layer1InputFuzzing', () => {
    it('returns Layer1Result with layer name', async () => {
      const result = await layer1InputFuzzing(SAMPLE_ISSUE_TITLE, SAMPLE_ISSUE_BODY);
      expect(result.layer).toBe('input-fuzzing');
    });

    it('passes when inputs are generated', async () => {
      const result = await layer1InputFuzzing(SAMPLE_ISSUE_TITLE, SAMPLE_ISSUE_BODY);
      expect(result.passed).toBe(true);
      expect(result.inputsGenerated).toBeGreaterThan(0);
    });

    it('reports findings with generated counts', async () => {
      const result = await layer1InputFuzzing(SAMPLE_ISSUE_TITLE, SAMPLE_ISSUE_BODY);
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.details).toContain('Generated');
    });

    it('flags risky inputs (prompt-injection + malformed)', async () => {
      const result = await layer1InputFuzzing(SAMPLE_ISSUE_TITLE, SAMPLE_ISSUE_BODY);
      expect(result.riskyInputs.length).toBeGreaterThan(0);
    });
  });
});

// ── Layer 2: Output Scanning ──────────────────────────────────────────────────

describe('Layer 2 — Output Scanning', () => {
  describe('scanAgentOutput', () => {
    it('passes clean agent output', () => {
      const result = scanAgentOutput(SAMPLE_AGENT_OUTPUT, SAMPLE_DIFF);
      expect(result.layer).toBe('output-scanning');
      expect(result.passed).toBe(true);
    });

    it('fails on SQL injection patterns in output', () => {
      const result = scanAgentOutput(UNSAFE_AGENT_OUTPUT, UNSAFE_DIFF);
      expect(result.passed).toBe(false);
    });

    it('detects eval() usage', () => {
      const result = scanAgentOutput('Using eval() to parse JSON input', '');
      expect(result.passed).toBe(false);
    });

    it('detects hardcoded passwords', () => {
      const result = scanAgentOutput('const password = "supersecret123!"', '');
      expect(result.passed).toBe(false);
    });

    it('detects hardcoded API keys', () => {
      const result = scanAgentOutput('const apiKey = "sk-abc123def456"', '');
      expect(result.passed).toBe(false);
    });

    it('detects private key embedding', () => {
      const result = scanAgentOutput('-----BEGIN RSA PRIVATE KEY-----\nMIICXAIBAA...', '');
      expect(result.passed).toBe(false);
    });

    it('detects AWS access keys', () => {
      const result = scanAgentOutput('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE', '');
      expect(result.passed).toBe(false);
    });

    it('detects GitHub tokens', () => {
      const result = scanAgentOutput('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789abcd', '');
      expect(result.passed).toBe(false);
    });

    it('detects dangerous innerHTML assignment', () => {
      const result = scanAgentOutput('element.innerHTML = "<div>" + userInput + "</div>"', '');
      expect(result.passed).toBe(false);
    });

    it('detects child_process usage', () => {
      const result = scanAgentOutput("const { exec } = require('child_process')", '');
      expect(result.passed).toBe(false);
    });

    it('returns pattern list with all entries', () => {
      const result = scanAgentOutput('clean output with no issues', '');
      expect(result.patterns.length).toBeGreaterThan(0);
      const foundPatterns = result.patterns.filter(p => p.found);
      expect(foundPatterns.length).toBe(0);
    });

    it('handles empty strings', () => {
      const result = scanAgentOutput('', '');
      expect(result.passed).toBe(true);
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('returns layer and details in result', () => {
      const result = scanAgentOutput('test', '');
      expect(result.layer).toBe('output-scanning');
      expect(result.details).toContain('chars');
    });

    it('scans both agent output and diff combined', () => {
      const badOutput = 'clean output';
      const badDiff = 'diff --git a/file.ts\n+  eval("malicious")';
      const result = scanAgentOutput(badOutput, badDiff);
      expect(result.passed).toBe(false);
    });
  });
});

// ── Layer 3: Consistency Check ────────────────────────────────────────────────

describe('Layer 3 — Consistency Check', () => {
  describe('layer3ConsistencyCheck', () => {
    it('passes when all checks are satisfied', async () => {
      const result = await layer3ConsistencyCheck(
        SAMPLE_ISSUE_TITLE,
        SAMPLE_ISSUE_BODY,
        SAMPLE_AGENT_OUTPUT,
        SAMPLE_DIFF,
      );
      expect(result.layer).toBe('consistency-check');
      expect(result.passed).toBe(true);
    });

    it('returns all check results', async () => {
      const result = await layer3ConsistencyCheck(
        SAMPLE_ISSUE_TITLE,
        SAMPLE_ISSUE_BODY,
        SAMPLE_AGENT_OUTPUT,
        SAMPLE_DIFF,
      );
      expect(result.checks.length).toBe(4);
    });

    it('fails when agent output misses key terms', async () => {
      const result = await layer3ConsistencyCheck(
        'Fix MongoDB connection pooling',
        'The connection pool in src/db/connection.ts is misconfigured. Max pool size should be 50.',
        'I fixed something in the config.',
        '',
      );
      // Fails keyword coverage + meaningful-changes + code-test-ratio = 1/4 = 25%
      expect(result.passed).toBe(false);
    });

    it('fails when no diff is provided', async () => {
      const result = await layer3ConsistencyCheck(
        SAMPLE_ISSUE_TITLE,
        SAMPLE_ISSUE_BODY,
        'Some text about fixing things',
        '',
      );
      expect(result.passed).toBe(false);
    });

    it('passes keyword coverage when most terms are present', async () => {
      const result = await layer3ConsistencyCheck(
        'Fix token validation bug',
        'The token validation is broken during edge cases',
        'I fixed the token validation bug during edge cases by updating the validation function.',
        SAMPLE_DIFF,
      );
      const keywordCheck = result.checks.find(c => c.check === 'keyword-coverage');
      expect(keywordCheck?.passed).toBe(true);
    });

    it('fails meaningful-changes check on empty diff', async () => {
      const result = await layer3ConsistencyCheck(
        SAMPLE_ISSUE_TITLE,
        SAMPLE_ISSUE_BODY,
        'Fixed the bug',
        '',
      );
      const meaningfulCheck = result.checks.find(c => c.check === 'meaningful-changes');
      expect(meaningfulCheck?.passed).toBe(false);
    });

    it('fails test-only changes in code-test-ratio check', async () => {
      const testOnlyDiff = `diff --git a/src/__tests__/test.test.ts b/src/__tests__/test.test.ts
new file mode 100644
index 000..abc 100644
--- /dev/null
+++ b/src/__tests__/test.test.ts
@@ -0,0 +1,10 @@
+import { describe, it, expect } from 'vitest';
+describe('test', () => {
+  it('works', () => {
+    expect(true).toBe(true);
+  });
+});`;

      const result = await layer3ConsistencyCheck(
        'Fix bug',
        'Something is broken',
        'Added test',
        testOnlyDiff,
      );
      const ratioCheck = result.checks.find(c => c.check === 'code-test-ratio');
      expect(ratioCheck?.passed).toBe(false);
    });

    it('returns findings for failed checks', async () => {
      const result = await layer3ConsistencyCheck(
        'Fix bug',
        'Something is broken',
        'I did something',
        '',
      );
      expect(result.findings.length).toBeGreaterThan(0);
    });
  });
});

// ── Full Pipeline ─────────────────────────────────────────────────────────────

describe('runAdversarialReview (full pipeline)', () => {
  it('approves when all layers pass', async () => {
    const result = await runAdversarialReview({
      title: SAMPLE_ISSUE_TITLE,
      body: SAMPLE_ISSUE_BODY,
      agentOutput: SAMPLE_AGENT_OUTPUT,
      diff: SAMPLE_DIFF,
    });

    expect(result.verdict).toBe('APPROVED');
    expect(result.passed).toBe(true);
  });

  it('rejects when agent output is unsafe', async () => {
    const result = await runAdversarialReview({
      title: 'Fix login security',
      body: 'The login endpoint has a SQL injection vulnerability. Please fix the password validation in `src/login.ts`.',
      agentOutput: UNSAFE_AGENT_OUTPUT,
      diff: UNSAFE_DIFF,
    });

    // Layer 2 fails (unsafe output patterns), Layer 3 fails (keyword coverage + file-modification)
    // Layer 1 always passes (generates adversarial inputs)
    expect(result.verdict).toBe('PARTIAL');
    expect(result.passed).toBe(false);
  });

  it('returns partial when some layers fail', async () => {
    const result = await runAdversarialReview({
      title: 'Fix login',
      body: 'The login is broken in `src/auth.ts`',
      agentOutput: UNSAFE_AGENT_OUTPUT,
      diff: SAMPLE_DIFF, // clean diff, but unsafe output
    });

    // Layer 2 will fail (unsafe patterns), layer 1 passes (inputs generated),
    // layer 3 may partially pass due to keyword coverage
    expect(result.verdict).toBe('PARTIAL');
    expect(result.passed).toBe(false);
  });

  it('produces summary with duration', async () => {
    const result = await runAdversarialReview({
      title: SAMPLE_ISSUE_TITLE,
      body: SAMPLE_ISSUE_BODY,
      agentOutput: SAMPLE_AGENT_OUTPUT,
      diff: SAMPLE_DIFF,
    });

    expect(result.summary).toContain('All 3 adversarial review layers passed');
    expect(result.summary).toMatch(/\(\d+ms\)/);
  });

  it('includes layer results in report', async () => {
    const result = await runAdversarialReview({
      title: SAMPLE_ISSUE_TITLE,
      body: SAMPLE_ISSUE_BODY,
      agentOutput: SAMPLE_AGENT_OUTPUT,
    });

    expect(result.layer1).toBeDefined();
    expect(result.layer2).toBeDefined();
    expect(result.layer3).toBeDefined();
    expect(result.layer1.layer).toBe('input-fuzzing');
    expect(result.layer2.layer).toBe('output-scanning');
    expect(result.layer3.layer).toBe('consistency-check');
  });

  it('handles minimal inputs with partial results', async () => {
    const result = await runAdversarialReview({
      title: 'Fix login bug in authentication',
      body: 'The login validation is returning wrong results',
      agentOutput: 'no fix provided',
      diff: '',
    });

    // Layer 1 passes (static adversarial inputs), Layer 2 passes (clean output), Layer 3 fails (empty diff)
    expect(result.verdict).toBe('PARTIAL');
    expect(result.passed).toBe(false);
  });
});
