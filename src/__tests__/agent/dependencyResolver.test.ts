/**
 * Unit tests for src/agent/dependencyResolver.ts — Pipeline Dependency Resolution (AIM-2037).
 *
 * Tests DAG construction, cycle detection, topological sort, and parallel batch grouping.
 *
 * ── Coverage ──────────────────────────────────────────────────────────
 * ✅ Simple linear chain (A <- B <- C)
 * ✅ Diamond dependency (A <- B, A <- C, B <- D, C <- D)
 * ✅ Cycle detection (A <- B, B <- A)
 * ✅ Self-loop detection (A <- A)
 * ✅ Independent issues (no blockers)
 * ✅ Empty input
 * ✅ Single issue
 * ✅ Complex DAG with mixed dependencies
 * ✅ External dependencies (blockedBy not in input list)
 * ✅ formatExecutionPlan output
 * ✅ filterKnownIssues helper
 * ──────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest';
import {
  resolveDependencies,
  formatExecutionPlan,
  filterKnownIssues,
} from '../../agent/dependencyResolver.js';
import type { DependencyIssue } from '../../agent/dependencyResolver.js';

/**
 * Helper: Create a DependencyIssue with a short id and optional blockedBy.
 */
function issue(id: string, ...blockedBy: string[]): DependencyIssue {
  return { id, title: `Issue ${id}`, blockedBy };
}

describe('resolveDependencies', () => {
  // ── Linear Chain ────────────────────────────────────────────────────
  describe('linear chain', () => {
    it('resolves a simple chain A <- B <- C', () => {
      const issues = [
        issue('A', 'B'),
        issue('B', 'C'),
        issue('C'),
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(true);
      expect(result.cycleDetected).toBe(false);
      // C must come before B, B before A
      expect(result.order.indexOf('C')).toBeLessThan(result.order.indexOf('B'));
      expect(result.order.indexOf('B')).toBeLessThan(result.order.indexOf('A'));
    });

    it('resolves a longer chain of 5 issues', () => {
      const issues = [
        issue('A', 'B'),
        issue('B', 'C'),
        issue('C', 'D'),
        issue('D', 'E'),
        issue('E'),
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(true);
      expect(result.order).toHaveLength(5);
      // Verify topological ordering
      expect(result.order.indexOf('E')).toBeLessThan(result.order.indexOf('D'));
      expect(result.order.indexOf('D')).toBeLessThan(result.order.indexOf('C'));
      expect(result.order.indexOf('C')).toBeLessThan(result.order.indexOf('B'));
      expect(result.order.indexOf('B')).toBeLessThan(result.order.indexOf('A'));
    });
  });

  // ── Diamond Dependency ──────────────────────────────────────────────
  describe('diamond dependency', () => {
    it('resolves a diamond: A depends on B and C, both depend on D', () => {
      const issues = [
        issue('A', 'B', 'C'),
        issue('B', 'D'),
        issue('C', 'D'),
        issue('D'),
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(true);
      expect(result.cycleDetected).toBe(false);
      // D must come first
      expect(result.order.indexOf('D')).toBe(0);
      // A must come after both B and C
      expect(result.order.indexOf('A')).toBeGreaterThan(result.order.indexOf('B'));
      expect(result.order.indexOf('A')).toBeGreaterThan(result.order.indexOf('C'));
      // B and C can be in any order relative to each other
    });

    it('groups B and C into the same parallel batch in a diamond', () => {
      const issues = [
        issue('A', 'B', 'C'),
        issue('B', 'D'),
        issue('C', 'D'),
        issue('D'),
      ];

      const result = resolveDependencies(issues);

      expect(result.parallelBatches.length).toBeGreaterThanOrEqual(2);
      // First batch should contain D only
      expect(result.parallelBatches[0]).toContain('D');
      // Last batch should contain A
      expect(result.parallelBatches[result.parallelBatches.length - 1]).toContain('A');
      // B and C should be in the same intermediate batch (parallel)
      const bAndCBatch = result.parallelBatches.find(
        (batch) => batch.includes('B') && batch.includes('C'),
      );
      expect(bAndCBatch).toBeDefined();
    });
  });

  // ── Cycle Detection ─────────────────────────────────────────────────
  describe('cycle detection', () => {
    it('detects a simple 2-node cycle', () => {
      const issues = [
        issue('A', 'B'),
        issue('B', 'A'),
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(false);
      expect(result.cycleDetected).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Cycle detected');
    });

    it('detects a 3-node cycle', () => {
      const issues = [
        issue('A', 'B'),
        issue('B', 'C'),
        issue('C', 'A'),
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(false);
      expect(result.cycleDetected).toBe(true);
      expect(result.error).toContain('Cycle detected');
    });

    it('detects a self-loop', () => {
      const issues = [
        issue('A', 'A'),
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(false);
      expect(result.cycleDetected).toBe(true);
      expect(result.error).toContain('Cycle detected');
    });

    it('returns cycle path in error', () => {
      const issues = [
        issue('A', 'B'),
        issue('B', 'A'),
      ];

      const result = resolveDependencies(issues);

      expect(result.cyclePath).toBeDefined();
      expect(result.cyclePath!.length).toBeGreaterThanOrEqual(2);
      // The cycle should include both A and B
      expect(result.cyclePath).toContain('A');
      expect(result.cyclePath).toContain('B');
    });

    it('detects cycle in a larger graph with mixed dependencies', () => {
      const issues = [
        issue('A', 'B'),
        issue('B', 'C', 'D'),
        issue('C'),
        issue('D', 'E'),
        issue('E', 'F'),
        issue('F', 'B'), // B -> ... -> F -> B creates cycle
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(false);
      expect(result.cycleDetected).toBe(true);
    });
  });

  // ── Independent Issues ──────────────────────────────────────────────
  describe('independent issues (parallel execution)', () => {
    it('groups all independent issues in the first batch', () => {
      const issues = [
        issue('A'),
        issue('B'),
        issue('C'),
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(true);
      expect(result.independentIssues).toEqual(expect.arrayContaining(['A', 'B', 'C']));
      expect(result.parallelBatches).toHaveLength(1);
      expect(result.parallelBatches[0]).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    });

    it('identifies independent issues in a mixed graph', () => {
      const issues = [
        issue('A', 'D'),
        issue('B'), // independent
        issue('C', 'D'),
        issue('D'), // independent
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(true);
      expect(result.independentIssues).toEqual(expect.arrayContaining(['B', 'D']));
      // First batch should contain independent issues
      expect(result.parallelBatches[0]).toEqual(expect.arrayContaining(['B', 'D']));
    });

    it('reports correct independentIssues count', () => {
      const issues = [
        issue('A', 'B'),
        issue('B', 'C'),
        issue('C'),
        issue('D'), // independent
        issue('E'), // independent
      ];

      const result = resolveDependencies(issues);

      expect(result.independentIssues).toHaveLength(3);
      expect(result.independentIssues).toEqual(expect.arrayContaining(['C', 'D', 'E']));
    });
  });

  // ── Empty Input ─────────────────────────────────────────────────────
  describe('empty input', () => {
    it('returns empty result for empty issues array', () => {
      const result = resolveDependencies([]);

      expect(result.success).toBe(true);
      expect(result.order).toHaveLength(0);
      expect(result.parallelBatches).toHaveLength(0);
      expect(result.independentIssues).toHaveLength(0);
      expect(result.cycleDetected).toBe(false);
    });
  });

  // ── Single Issue ────────────────────────────────────────────────────
  describe('single issue', () => {
    it('handles a single issue with no dependencies', () => {
      const issues = [issue('A')];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(true);
      expect(result.order).toEqual(['A']);
      expect(result.parallelBatches).toHaveLength(1);
      expect(result.parallelBatches[0]).toEqual(['A']);
      expect(result.independentIssues).toEqual(['A']);
    });

    it('handles a single issue with a dependency', () => {
      const issues = [issue('A', 'B')];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(true);
      expect(result.order).toContain('A');
      expect(result.order).toContain('B');
      expect(result.order.indexOf('B')).toBeLessThan(result.order.indexOf('A'));
    });
  });

  // ── Complex DAG ─────────────────────────────────────────────────────
  describe('complex DAG with mixed dependencies', () => {
    it('resolves a complex dependency graph', () => {
      //     A
      //    / \
      //   B   C
      //  / \ / \
      // D   E   F
      //  \ / \ /
      //   G   H
      const issues = [
        issue('A', 'B', 'C'),
        issue('B', 'D', 'E'),
        issue('C', 'E', 'F'),
        issue('D', 'G'),
        issue('E', 'G', 'H'),
        issue('F', 'H'),
        issue('G'),
        issue('H'),
      ];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(true);
      expect(result.cycleDetected).toBe(false);
      expect(result.order).toHaveLength(8);

      // Verify key ordering constraints
      const order = result.order;
      expect(order.indexOf('G')).toBeLessThan(order.indexOf('D'));
      expect(order.indexOf('G')).toBeLessThan(order.indexOf('E'));
      expect(order.indexOf('H')).toBeLessThan(order.indexOf('E'));
      expect(order.indexOf('H')).toBeLessThan(order.indexOf('F'));
      expect(order.indexOf('D')).toBeLessThan(order.indexOf('B'));
      expect(order.indexOf('E')).toBeLessThan(order.indexOf('B'));
      expect(order.indexOf('E')).toBeLessThan(order.indexOf('C'));
      expect(order.indexOf('F')).toBeLessThan(order.indexOf('C'));
      expect(order.indexOf('B')).toBeLessThan(order.indexOf('A'));
      expect(order.indexOf('C')).toBeLessThan(order.indexOf('A'));
    });

    it('produces parallel batches that respect dependencies', () => {
      // A <- B, A <- C (A blocked by B and C)
      // B <- D, C <- D (B and C blocked by D)
      const issues = [
        issue('A', 'B', 'C'),
        issue('B', 'D'),
        issue('C', 'D'),
        issue('D'),
      ];

      const result = resolveDependencies(issues);

      // Verify no batch contains A and D together (D must be before A)
      for (const batch of result.parallelBatches) {
        if (batch.includes('A')) {
          expect(batch).not.toContain('D');
        }
      }
    });
  });

  // ── External Dependencies ───────────────────────────────────────────
  describe('external dependencies', () => {
    it('handles blockedBy referencing an issue not in the input list', () => {
      // 'B' is not in the input list, but A says it's blocked by B
      const issues = [issue('A', 'B')];

      const result = resolveDependencies(issues);

      expect(result.success).toBe(true);
      // B should be in the order (added as external node)
      expect(result.order).toContain('B');
      expect(result.order.indexOf('B')).toBeLessThan(result.order.indexOf('A'));
      // B should NOT be in independentIssues (since it's external, not in our issue list)
      expect(result.independentIssues).not.toContain('B');
    });
  });

  // ── Execution Plan Output ───────────────────────────────────────────
  describe('formatExecutionPlan', () => {
    it('formats a successful plan', () => {
      const result = resolveDependencies([
        issue('A', 'B'),
        issue('B'),
        issue('C'),
      ]);

      const plan = formatExecutionPlan(result);

      expect(plan).toContain('Dependency Resolution Complete');
      expect(plan).toContain('A');
      expect(plan).toContain('B');
      expect(plan).toContain('C');
    });

    it('formats a failed plan with cycle', () => {
      const result = resolveDependencies([
        issue('A', 'B'),
        issue('B', 'A'),
      ]);

      const plan = formatExecutionPlan(result);

      expect(plan).toContain('Dependency Resolution FAILED');
      expect(plan).toContain('Cycle detected');
    });
  });

  // ── filterKnownIssues ───────────────────────────────────────────────
  describe('filterKnownIssues', () => {
    it('filters out external dependencies from the order', () => {
      const issues = [issue('A', 'B')];
      const result = resolveDependencies(issues);

      const knownIds = new Set(issues.map((i) => i.id));
      const filtered = filterKnownIssues(result.order, knownIds);

      expect(filtered).toEqual(['A']);
      expect(filtered).not.toContain('B');
    });

    it('returns empty array when no known issues remain', () => {
      const filtered = filterKnownIssues(['X', 'Y', 'Z'], new Set(['A']));
      expect(filtered).toHaveLength(0);
    });

    it('preserves order when filtering', () => {
      const filtered = filterKnownIssues(['C', 'B', 'A'], new Set(['A', 'B']));
      expect(filtered).toEqual(['B', 'A']);
    });
  });
});
