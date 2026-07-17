/**
 * Unit tests for src/core/mci-verifier.ts — PR-MCI (message-code inconsistency) verification.
 *
 * Tests cover:
 * 1. Perfect match (high score)
 * 2. Description with phantom files (low score)
 * 3. Description with no files mentioned (keyword score only)
 * 4. Empty diff
 * 5. Empty description
 * 6. Generic description with no specific details
 * 7. Description that matches partially
 * 8. Threshold override
 * 9. Markdown-heavy description
 * 10. Large diff with multiple files
 */

import { describe, expect, it } from 'vitest';
import { verifyMciconsistency } from '../core/mci-verifier.js';

// ── Sample diffs ─────────────────────────────────────────────────────────────

const SIMPLE_DIFF = [
  'diff --git a/src/login.ts b/src/login.ts',
  'index abc..def 100644',
  '--- a/src/login.ts',
  '+++ b/src/login.ts',
  '@@ -10,3 +10,5 @@',
  '+  // Sanitize input',
  '+  const sanitized = escapeSpecialChars(input);',
  ' }',
  '',
  'diff --git a/src/tests/login.test.ts b/src/tests/login.test.ts',
  'index 123..456 100644',
  '--- a/src/tests/login.test.ts',
  '+++ b/src/tests/login.test.ts',
  '@@ -1,3 +1,10 @@',
  '+describe("sanitization", () => {',
  '+  it("escapes special characters", () => {',
  '+    expect(escapeSpecialChars("foo&bar")).toBe("foo&amp;bar");',
  '+  });',
  '+});',
].join('\n');

const MULTI_FILE_DIFF = [
  'diff --git a/src/auth/login.ts b/src/auth/login.ts',
  'index a1b..c2d 100644',
  '--- a/src/auth/login.ts',
  '+++ b/src/auth/login.ts',
  '@@ -15,4 +15,6 @@',
  '   const user = await findUser(email);',
  '+  if (!user) {',
  '+    throw new Error("User not found");',
  '+  }',
  ' }',
  '',
  'diff --git a/src/auth/register.ts b/src/auth/register.ts',
  'index e3f..g4h 100644',
  '--- a/src/auth/register.ts',
  '+++ b/src/auth/register.ts',
  '@@ -30,7 +30,9 @@',
  '   const hash = await bcrypt.hash(password, 10);',
  '+  const sanitizedEmail = email.toLowerCase().trim();',
  ' }',
].join('\n');

// ── Tests ────────────────────────────────────────────────────────────────────

describe('verifyMciconsistency', () => {
  it('returns a high score when description accurately matches the diff', () => {
    const description = 'Fixed input sanitization in `src/login.ts`. Added escaping for special characters.';
    const result = verifyMciconsistency(description, SIMPLE_DIFF);

    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.passed).toBe(true);
    expect(result.phantomChanges).toHaveLength(0);
    expect(result.details.length).toBeGreaterThan(0);
  });

  it('returns a low score when description claims changes not in diff (phantom files)', () => {
    const description = 'Refactored `src/database.ts` and `src/api/routes.ts` to fix the bug.';
    const result = verifyMciconsistency(description, SIMPLE_DIFF);

    expect(result.score).toBeLessThan(40);
    expect(result.passed).toBe(false);
    expect(result.phantomChanges.length).toBeGreaterThan(0);
    expect(result.phantomChanges).toContain('src/database.ts');
    expect(result.phantomChanges).toContain('src/api/routes.ts');
  });

  it('returns a passing score when description has no file paths (prose-only)', () => {
    const description = 'Fixed input sanitization in the login handler. Added special character escaping.';
    const result = verifyMciconsistency(description, SIMPLE_DIFF);

    // No files in description = file score defaults to max (60)
    // Keyword match should pick up login, sanitization, escaping, etc.
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.passed).toBe(true);
    expect(result.phantomChanges).toHaveLength(0);
  });

  it('handles an empty diff gracefully', () => {
    const description = 'Fixed the login bug.';
    const result = verifyMciconsistency(description, '');

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    // Should still produce a valid result
    expect(result.details.length).toBeGreaterThan(0);
  });

  it('handles an empty description gracefully', () => {
    const result = verifyMciconsistency('', SIMPLE_DIFF);

    // Empty description = no files, no keywords = maxed file score
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.phantomChanges).toHaveLength(0);
  });

  it('detects phantom changes when description mentions files not touched', () => {
    const description = 'Added null check in `src/auth/login.ts` and updated `src/config.ts`.';
    const result = verifyMciconsistency(description, MULTI_FILE_DIFF);

    // `src/auth/login.ts` exists in diff, `src/config.ts` does not
    expect(result.phantomChanges).toContain('src/config.ts');
    expect(result.phantomChanges).not.toContain('src/auth/login.ts');
    expect(result.passed).toBe(false);
  });

  it('respects a custom threshold', () => {
    const description = 'Refactored `src/database.ts` and `src/api/routes.ts` to fix the bug.';
    const result = verifyMciconsistency(description, SIMPLE_DIFF, 10);

    // With a very low threshold, it might pass
    expect(result.score).toBeLessThan(40);
    // But the passed flag uses the custom threshold
    expect(result.passed).toBe(result.score >= 10);
  });

  it('handles markdown-heavy descriptions', () => {
    const description = [
      '## Summary',
      '',
      'This fix addresses the **login issue** by improving `src/login.ts`.',
      '',
      '### Changes',
      '- Added sanitization in `src/login.ts`',
      '- Updated tests in `src/tests/login.test.ts`',
      '',
      '### Why',
      'Special characters were not being escaped.',
    ].join('\n');

    const result = verifyMciconsistency(description, SIMPLE_DIFF);

    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.passed).toBe(true);
    expect(result.phantomChanges).toHaveLength(0);
  });

  it('handles a partial match — some keywords from description appear in diff', () => {
    const description = 'Fixed the rendering issue in `src/login.ts`. Updated styles.';
    // `src/login.ts` matches, but "rendering" and "styles" don't appear in the diff
    const result = verifyMciconsistency(description, SIMPLE_DIFF);

    // File match gives some points, keyword match gives partial
    expect(result.score).toBeGreaterThan(30);
    expect(result.score).toBeLessThan(90);
  });

  it('produces consistent results regardless of diff ordering', () => {
    const description = 'Fixed input sanitization in `src/login.ts`. Added new tests.';
    const result1 = verifyMciconsistency(description, SIMPLE_DIFF);

    // Reverse the diff lines — order shouldn't matter
    const lines = SIMPLE_DIFF.split('\n');
    const reversedDiff = lines.reverse().join('\n');
    const result2 = verifyMciconsistency(description, reversedDiff);

    expect(result1.score).toBe(result2.score);
    expect(result1.phantomChanges).toEqual(result2.phantomChanges);
  });

  it('scores 0 when description has phantom files and zero keyword overlap', () => {
    const description = 'Refactored `src/xyz.ts` to add quantum computing support.';
    const result = verifyMciconsistency(description, SIMPLE_DIFF);

    // `src/xyz.ts` doesn't exist in diff (phantom), and "quantum computing" doesn't appear
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.phantomChanges).toContain('src/xyz.ts');
  });

  it('exposes phantom changes in the result', () => {
    const description = 'Updated `src/login.ts`, `src/missing.ts`, and `src/ghost.ts`.';
    const result = verifyMciconsistency(description, SIMPLE_DIFF);

    expect(result.phantomChanges).toContain('src/missing.ts');
    expect(result.phantomChanges).toContain('src/ghost.ts');
    expect(result.phantomChanges).not.toContain('src/login.ts');
    expect(result.phantomChanges.length).toBe(2);
  });
});
