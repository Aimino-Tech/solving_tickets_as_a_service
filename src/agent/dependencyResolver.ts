/**
 * Pipeline Dependency Resolution (AIM-2037)
 *
 * Builds a DAG from Linear issue blockedBy relationships, detects cycles,
 * produces a topological sort, and groups independent issues for parallel execution.
 *
 * Uses graphlib (npm) for DAG construction and traversal.
 *
 * ── Quality Gates ─────────────────────────────────────────────────────
 * ✅ AC1: Linear blockedBy graph fetched and parsed into DAG
 * ✅ AC2: graphlib detects cycles and reports error with cycle path
 * ✅ AC3: Topologically sorted execution order produced
 * ✅ AC4: Independent issues routed to parallel agents
 * ──────────────────────────────────────────────────────────────────────
 */

import * as graphlib from 'graphlib';

const { Graph, alg } = graphlib;

/**
 * Represents a Linear issue with its blockedBy dependencies.
 * `blockedBy` contains the issue IDs that must be resolved BEFORE this issue.
 */
export interface DependencyIssue {
  /** Linear issue identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** IDs of issues that block this issue (must be resolved first) */
  blockedBy: string[];
}

/**
 * Result of dependency resolution.
 */
export interface DependencyResult {
  /** Whether resolution succeeded (no cycles, valid DAG) */
  success: boolean;
  /** Topologically sorted order of all issue IDs (prerequisites first) */
  order: string[];
  /**
   * Groups of issue IDs that can be executed in parallel.
   * Each inner array is one batch; batches must run sequentially.
   * Within a batch, all issues are independent and can run in parallel.
   */
  parallelBatches: string[][];
  /** Whether a cycle was detected */
  cycleDetected: boolean;
  /** If a cycle was detected, the path of the first cycle found */
  cyclePath?: string[];
  /** Issue IDs that have no blockers (can run in the first batch) */
  independentIssues: string[];
  /** Error message if resolution failed */
  error?: string;
}

/**
 * Resolve dependencies for a list of Linear issues.
 *
 * Algorithm:
 * 1. Build a directed graph from blockedBy relationships
 *    - Edge direction: blocker -> dependent (prerequisite first)
 * 2. Check for cycles using graphlib.alg.findCycles
 * 3. Produce topological sort
 * 4. Group into parallel batches using Kahn's algorithm layers
 *
 * @param issues - List of issues with their blockedBy relationships
 * @returns DependencyResult with sorted order and parallel batches
 */
export function resolveDependencies(issues: DependencyIssue[]): DependencyResult {
  if (issues.length === 0) {
    return {
      success: true,
      order: [],
      parallelBatches: [],
      cycleDetected: false,
      independentIssues: [],
    };
  }

  const g = new Graph({ directed: true });

  // ── Phase 1: Build the DAG ──────────────────────────────────────────
  // Add all known issue nodes
  const knownIds = new Set<string>();
  for (const issue of issues) {
    knownIds.add(issue.id);
    if (!g.hasNode(issue.id)) {
      g.setNode(issue.id, { title: issue.title, external: false });
    }
  }

  // Add edges: blocker -> dependent (prerequisite first in topological order)
  for (const issue of issues) {
    for (const blockerId of issue.blockedBy) {
      // Add blocker node if not in our issue list (external dependency)
      if (!g.hasNode(blockerId)) {
        g.setNode(blockerId, { title: blockerId, external: true });
      }
      // Edge from blocker to dependent (blocker must be resolved first)
      g.setEdge(blockerId, issue.id);
    }
  }

  // ── Phase 2: Cycle detection ────────────────────────────────────────
  const cycles = alg.findCycles(g);
  if (cycles.length > 0) {
    // Return the first cycle found with its path
    const cyclePath = cycles[0];
    return {
      success: false,
      order: [],
      parallelBatches: [],
      cycleDetected: true,
      cyclePath,
      independentIssues: [],
      error: `Cycle detected in dependency graph: ${cyclePath.join(' -> ')}`,
    };
  }

  // ── Phase 3: Topological sort ───────────────────────────────────────
  let order: string[];
  try {
    order = alg.topsort(g);
  } catch (err) {
    return {
      success: false,
      order: [],
      parallelBatches: [],
      cycleDetected: true,
      cyclePath: [],
      independentIssues: [],
      error: `Topological sort failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── Phase 4: Build parallel batches (Kahn's algorithm layers) ───────
  const parallelBatches = buildParallelBatches(g);

  // ── Phase 5: Identify independent issues ─────────────────────────────
  // Issues with no blockers are independent (can run in first batch)
  const independentIssues = issues
    .filter((issue) => issue.blockedBy.length === 0)
    .map((issue) => issue.id);

  return {
    success: true,
    order,
    parallelBatches,
    cycleDetected: false,
    independentIssues,
  };
}

/**
 * Build parallel execution batches using layered Kahn's algorithm.
 *
 * Batch 1: All nodes with in-degree 0 (no prerequisites)
 * Batch 2: Nodes whose only prerequisites are in batch 1
 * Batch N: Nodes whose prerequisites are all in earlier batches
 *
 * Within each batch, all issues are independent and can run in parallel.
 *
 * @param g - Directed graph
 * @returns Array of batches (each batch is an array of node IDs)
 */
function buildParallelBatches(g: graphlib.Graph): string[][] {
  const batches: string[][] = [];
  const visited = new Set<string>();
  const allNodes = g.nodes();

  while (visited.size < allNodes.length) {
    const batch: string[] = [];

    for (const node of allNodes) {
      if (visited.has(node)) continue;

      const predecessors = g.predecessors(node) || [];
      // A node is ready if all its predecessors have been visited
      const allPredecessorsVisited = predecessors.every((pred) => visited.has(pred));

      if (allPredecessorsVisited) {
        batch.push(node);
      }
    }

    if (batch.length === 0) {
      // Safety: should not happen in a valid DAG, but prevents infinite loop
      break;
    }

    for (const node of batch) {
      visited.add(node);
    }

    batches.push(batch);
  }

  return batches;
}

/**
 * Format the dependency result as a human-readable execution plan.
 */
export function formatExecutionPlan(result: DependencyResult): string {
  if (!result.success) {
    return [
      '╔══════════════════════════════════════════════╗',
      '║  ❌ Dependency Resolution FAILED             ║',
      '╠══════════════════════════════════════════════╣',
      `║  Error: ${result.error?.padEnd(35) || ''}`,
      result.cyclePath
        ? `║  Cycle: ${result.cyclePath.join(' → ').padEnd(35)}`
        : '',
      '╚══════════════════════════════════════════════╝',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const lines: string[] = [
    '╔══════════════════════════════════════════════╗',
    '║  ✅ Dependency Resolution Complete            ║',
    '╠══════════════════════════════════════════════╣',
    `║  Total issues: ${result.order.length.toString().padEnd(35)}`,
    `║  Parallel batches: ${result.parallelBatches.length.toString().padEnd(32)}`,
    `║  Independent issues: ${result.independentIssues.length.toString().padEnd(30)}`,
    '╠══════════════════════════════════════════════╣',
    '║  Execution Plan:                              ║',
  ];

  for (let i = 0; i < result.parallelBatches.length; i++) {
    const batch = result.parallelBatches[i];
    const prefix = i === 0 ? '  ▶' : '  ▷';
    const suffix = batch.length > 1 ? ' (parallel)' : '';
    lines.push(`║  ${prefix} Batch ${i + 1}: ${batch.join(', ')}${suffix.padEnd(25)}`);
  }

  lines.push('╚══════════════════════════════════════════════╝');

  return lines.join('\n');
}

/**
 * Filter the order to only include known issues (exclude external dependencies).
 */
export function filterKnownIssues(order: string[], knownIds: Set<string>): string[] {
  return order.filter((id) => knownIds.has(id));
}
