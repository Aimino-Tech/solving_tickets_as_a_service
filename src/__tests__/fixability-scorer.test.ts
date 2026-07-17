/**
 * Unit tests for FixabilityScorer.
 */
import { describe, expect, it } from 'vitest';
import { FixabilityScorer, type IssueData } from '../core/fixability-scorer.js';

function makeIssue(overrides: Partial<IssueData> & { issueNumber: number }): IssueData {
  return {
    title: 'Fix login validation bug',
    body: 'The login endpoint returns 500 when the email contains special characters like + or &.',
    labels: ['bug'],
    ...overrides,
  };
}

describe('FixabilityScorer', () => {
  const scorer = new FixabilityScorer();

  describe('score()', () => {
    it('returns high confidence for a well-described bug with a good label', () => {
      const result = scorer.score(makeIssue({ issueNumber: 1 }));
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.confidence).toBe('high');
      expect(result.estimatedFixTime).toBe('5–15 min');
    });

    it('returns low score for a vague migration issue', () => {
      const result = scorer.score(
        makeIssue({
          issueNumber: 2,
          title: 'Migrate the API to v2',
          body: 'We need to upgrade everything to the new version.',
          labels: ['enhancement'],
        }),
      );
      expect(result.score).toBeLessThanOrEqual(40);
      expect(result.confidence).toBe('low');
    });

    it('penalises "refactor" and "upgrade" keywords', () => {
      const result = scorer.score(
        makeIssue({
          issueNumber: 3,
          title: 'Refactor the database layer',
          body: 'We should upgrade the ORM and restructure the schema.',
          labels: [],
        }),
      );
      // Each keyword triggers -10: refactor + upgrade = -20
      expect(result.score).toBeLessThanOrEqual(35);
    });

    it('boosts score for referencing specific files', () => {
      const result = scorer.score(
        makeIssue({
          issueNumber: 4,
          body: 'The bug is in `src/auth/login.ts` — the validation function skips email checks.',
          labels: ['bug'],
        }),
      );
      expect(result.score).toBeGreaterThanOrEqual(75);
    });

    it('penalises multi-file references', () => {
      const result = scorer.score(
        makeIssue({
          issueNumber: 5,
          body: 'Need changes in `a.ts`, `b.ts`, `c.ts`, `d.ts`, and `e.ts`.',
          labels: [],
        }),
      );
      expect(result.score).toBeLessThanOrEqual(55);
    });

    it('penalises vague titles with "something"', () => {
      const result = scorer.score(
        makeIssue({
          issueNumber: 6,
          title: 'Fix something in the UI',
          body: '',
          labels: [],
        }),
      );
      expect(result.score).toBeLessThanOrEqual(45);
      expect(result.confidence).toBe('medium');
    });

    it('returns a very low score for the worst-case issue', () => {
      const result = scorer.score({
        issueNumber: 7,
        title: 'Fix',
        body: '',
        labels: ['epic'],
      });
      expect(result.score).toBeLessThanOrEqual(20);
      expect(result.confidence).toBe('low');
    });

    it('returns a high score for the best-case issue', () => {
      const result = scorer.score({
        issueNumber: 8,
        title: 'Fix null-pointer in UserService.getProfile()',
        body: 'When a user has no email set, `getProfile()` crashes with a null-pointer exception. The fix is in `src/services/user.ts` around line 42 — we need an optional chaining guard.',
        labels: ['bug', 'good first issue'],
      });
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.confidence).toBe('high');
    });

    it('labels all score fields correctly in the result', () => {
      const result = scorer.score(makeIssue({ issueNumber: 9 }));
      expect(result).toHaveProperty('issueNumber', 9);
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('estimatedFixTime');
      expect(typeof result.score).toBe('number');
      expect(['high', 'medium', 'low']).toContain(result.confidence);
      expect(typeof result.reason).toBe('string');
      expect(typeof result.estimatedFixTime).toBe('string');
    });
  });

  describe('scoreBatch()', () => {
    it('sorts results by score descending', () => {
      const issues: IssueData[] = [
        makeIssue({ issueNumber: 1, title: 'Fix something', body: '', labels: [] }),
        makeIssue({ issueNumber: 2, title: 'Well-described bug with files', body: 'Check `src/a.ts`', labels: ['bug'] }),
        makeIssue({ issueNumber: 3, title: 'Refactor everything', body: 'Complex migration upgrade', labels: ['epic'] }),
      ];

      const results = scorer.scoreBatch(issues);

      expect(results).toHaveLength(3);
      // Should be sorted descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });
});
