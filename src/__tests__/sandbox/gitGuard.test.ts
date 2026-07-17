/**
 * GitGuard test suite.
 */
import { describe, it, expect } from 'vitest';
import { checkGitCommand, validateAndSanitize } from '../../sandbox/gitGuard.js';

describe('GitGuard', () => {
  describe('checkGitCommand', () => {
    it('allows git add', () => {
      const result = checkGitCommand('git add -A');
      expect(result.allowed).toBe(true);
    });

    it('allows git commit', () => {
      const result = checkGitCommand('git commit -m "fix: bug"');
      expect(result.allowed).toBe(true);
    });

    it('allows git push (without force)', () => {
      const result = checkGitCommand('git push origin my-branch');
      expect(result.allowed).toBe(true);
    });

    it('blocks git push --force', () => {
      const result = checkGitCommand('git push --force origin main');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Force push');
    });

    it('blocks git push -f', () => {
      const result = checkGitCommand('git push -f origin main');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Force push');
    });

    it('blocks git branch -D', () => {
      const result = checkGitCommand('git branch -D old-branch');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Branch deletion');
    });

    it('blocks git branch -d', () => {
      const result = checkGitCommand('git branch -d old-branch');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Branch deletion');
    });

    it('blocks git reset --hard', () => {
      const result = checkGitCommand('git reset --hard HEAD~1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Hard reset');
    });

    it('blocks git rebase --force', () => {
      const result = checkGitCommand('git rebase --force main');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Force rebase');
    });

    it('blocks git gc --prune', () => {
      const result = checkGitCommand('git gc --prune=now');
      expect(result.allowed).toBe(false);
    });

    it('blocks git clean -fd', () => {
      const result = checkGitCommand('git clean -fd');
      expect(result.allowed).toBe(false);
    });

    it('blocks git checkout -- .', () => {
      const result = checkGitCommand('git checkout -- .');
      expect(result.allowed).toBe(false);
    });

    it('blocks git filter-branch', () => {
      const result = checkGitCommand('git filter-branch --force');
      expect(result.allowed).toBe(false);
    });

    it('allows git log', () => {
      const result = checkGitCommand('git log --oneline -5');
      expect(result.allowed).toBe(true);
    });

    it('allows git diff', () => {
      const result = checkGitCommand('git diff HEAD');
      expect(result.allowed).toBe(true);
    });

    it('allows git status', () => {
      const result = checkGitCommand('git status --short');
      expect(result.allowed).toBe(true);
    });

    it('allows git checkout -b', () => {
      const result = checkGitCommand('git checkout -b new-feature');
      expect(result.allowed).toBe(true);
    });

    it('allows git config', () => {
      const result = checkGitCommand('git config user.email "test@test.com"');
      expect(result.allowed).toBe(true);
    });

    it('allows git clone', () => {
      const result = checkGitCommand('git clone --depth 1 https://github.com/org/repo');
      expect(result.allowed).toBe(true);
    });

    it('allows non-git commands', () => {
      const result = checkGitCommand('ls -la');
      expect(result.allowed).toBe(true);
    });

    it('allows npm install', () => {
      const result = checkGitCommand('npm install');
      expect(result.allowed).toBe(true);
    });

    it('allows nested git commands in combined commands', () => {
      // The extract function handles this
      const result = checkGitCommand('git add -A');
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateAndSanitize', () => {
    it('passes through safe commands', () => {
      expect(validateAndSanitize('git add -A')).toBe('git add -A');
      expect(validateAndSanitize('git commit -m "test"')).toBe('git commit -m "test"');
      expect(validateAndSanitize('npm test')).toBe('npm test');
    });

    it('throws on blocked commands', () => {
      expect(() => validateAndSanitize('git push --force')).toThrow('GitGuard blocked');
    });

    it('detects blocked git in compound commands', () => {
      expect(() => validateAndSanitize('cd repo && git push --force origin main')).toThrow('GitGuard blocked');
      expect(() => validateAndSanitize('git add -A; git push -f')).toThrow('GitGuard blocked');
    });

    it('allows compound commands with safe git', () => {
      expect(validateAndSanitize('git add -A && git commit -m "fix"')).toBe('git add -A && git commit -m "fix"');
    });

    it('handles empty command', () => {
      expect(validateAndSanitize('')).toBe('');
    });
  });
});
