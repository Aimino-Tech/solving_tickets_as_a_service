import { describe, it, expect } from "vitest";
import {
  evaluatePassRate,
  evaluateSpeed,
  computeHealthScore,
  buildRecommendations,
  formatUsage,
  aggregateRepoHealth,
  evaluateProject,
  computeFeedbackLoop,
} from "@/utils/evaluation";
import type { DashboardStats, Run, RunStatus } from "@/api/types";

function makeStats(overrides?: Partial<DashboardStats>): DashboardStats {
  return {
    totalRuns: 10,
    passRate: 85,
    avgDurationSeconds: 120,
    activeRepos: 5,
    runsByDay: [],
    costByDay: [],
    fixRateByWeek: [],
    ...overrides,
  };
}

describe("evaluatePassRate", () => {
  it("returns good for rate >= 85", () => {
    expect(evaluatePassRate(85)).toBe("good");
    expect(evaluatePassRate(100)).toBe("good");
    expect(evaluatePassRate(90)).toBe("good");
  });

  it("returns warning for rate 50-84", () => {
    expect(evaluatePassRate(50)).toBe("warning");
    expect(evaluatePassRate(84)).toBe("warning");
    expect(evaluatePassRate(70)).toBe("warning");
  });

  it("returns critical for rate < 50", () => {
    expect(evaluatePassRate(49)).toBe("critical");
    expect(evaluatePassRate(0)).toBe("critical");
    expect(evaluatePassRate(30)).toBe("critical");
  });

  it("returns empty for null", () => {
    expect(evaluatePassRate(null)).toBe("empty");
  });

  it("returns empty for undefined", () => {
    expect(evaluatePassRate(undefined as unknown as null)).toBe("empty");
  });
});

describe("evaluateSpeed", () => {
  it("returns good for <= 180 seconds", () => {
    expect(evaluateSpeed(180)).toBe("good");
    expect(evaluateSpeed(120)).toBe("good");
    expect(evaluateSpeed(0)).toBe("good");
  });

  it("returns warning for 181-300 seconds", () => {
    expect(evaluateSpeed(181)).toBe("warning");
    expect(evaluateSpeed(300)).toBe("warning");
    expect(evaluateSpeed(240)).toBe("warning");
  });

  it("returns critical for > 300 seconds", () => {
    expect(evaluateSpeed(301)).toBe("critical");
    expect(evaluateSpeed(600)).toBe("critical");
  });

  it("returns empty for null", () => {
    expect(evaluateSpeed(null)).toBe("empty");
  });
});

describe("computeHealthScore", () => {
  it("returns score 100 for perfect stats (passRate=100, avg=120)", () => {
    const stats = makeStats({ passRate: 100, avgDurationSeconds: 120 });
    const result = computeHealthScore(stats);
    expect(result.score).toBe(100);
    expect(result.severity).toBe("good");
  });

  it("returns score 20 for worst stats with no failure data (passRate=0, avg=900)", () => {
    const stats = makeStats({ passRate: 0, avgDurationSeconds: 900 });
    const result = computeHealthScore(stats);
    expect(result.score).toBe(20);
    expect(result.severity).toBe("critical");
  });

  it("returns null and empty severity for null stats", () => {
    const result = computeHealthScore(null);
    expect(result.score).toBeNull();
    expect(result.severity).toBe("empty");
    expect(result.breakdown).toEqual({
      passRate: 0,
      speedScore: 0,
      errorScore: 0,
    });
  });

  it("computes correct breakdown values", () => {
    const stats = makeStats({ passRate: 80, avgDurationSeconds: 200 });
    const result = computeHealthScore(stats);
    expect(result.breakdown.passRate).toBe(80);
    expect(result.breakdown.speedScore).toBeCloseTo(96.67, 0);
    expect(result.breakdown.errorScore).toBe(100);
  });

  it("clamps speed score to 0 for very high avg durations", () => {
    const stats = makeStats({ passRate: 80, avgDurationSeconds: 780 });
    const result = computeHealthScore(stats);
    expect(result.breakdown.speedScore).toBe(0);
  });

  it("clamps speed score to 100 for low durations", () => {
    const stats = makeStats({ passRate: 80, avgDurationSeconds: 60 });
    const result = computeHealthScore(stats);
    expect(result.breakdown.speedScore).toBe(100);
  });

  it("severity is warning for score 50-84", () => {
    const stats = makeStats({ passRate: 50, avgDurationSeconds: 300 });
    const result = computeHealthScore(stats);
    expect(result.severity).toBe("warning");
  });
});

describe("buildRecommendations", () => {
  it("returns usage-warning when quota >= 80% and < 100%", () => {
    const stats = makeStats();
    const recs = buildRecommendations(stats, 8, 10, false, false);
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe("usage-warning");
    expect(recs[0].severity).toBe("warning");
  });

  it("returns usage-exhausted when quota >= 100%", () => {
    const stats = makeStats();
    const recs = buildRecommendations(stats, 10, 10, false, false);
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe("usage-exhausted");
    expect(recs[0].severity).toBe("critical");
  });

  it("returns pass-rate-critical when passRate < 50", () => {
    const stats = makeStats({ passRate: 40 });
    const recs = buildRecommendations(stats, 0, 10, false, false);
    const passRateRec = recs.find((r) => r.id === "pass-rate-critical");
    expect(passRateRec).toBeDefined();
    expect(passRateRec?.severity).toBe("critical");
  });

  it("returns no-runs info when stats have zero totalRuns", () => {
    const stats = makeStats({ totalRuns: 0 });
    const recs = buildRecommendations(stats, 0, 10, false, false);
    const noRunsRec = recs.find((r) => r.id === "no-runs");
    expect(noRunsRec).toBeDefined();
    expect(noRunsRec?.severity).toBe("info");
  });

  it("returns no-repos info when activeRepos is 0", () => {
    const stats = makeStats({ activeRepos: 0 });
    const recs = buildRecommendations(stats, 0, 10, false, false);
    const noReposRec = recs.find((r) => r.id === "no-repos");
    expect(noReposRec).toBeDefined();
    expect(noReposRec?.severity).toBe("info");
  });

  it("returns empty array when nothing applies", () => {
    const stats = makeStats({ passRate: 90, activeRepos: 5, totalRuns: 20 });
    const recs = buildRecommendations(stats, 5, 10, false, false);
    expect(recs).toHaveLength(0);
  });

  it("returns empty array when unlimited plan", () => {
    const stats = makeStats({ passRate: 90, activeRepos: 5, totalRuns: 20 });
    const recs = buildRecommendations(stats, 100, 10, true, false);
    expect(recs).toHaveLength(0);
  });
});

describe("formatUsage", () => {
  it("returns used/limit format for limited plans", () => {
    expect(formatUsage(0, 10, false)).toBe("0/10");
    expect(formatUsage(5, 10, false)).toBe("5/10");
    expect(formatUsage(42, 10, false)).toBe("42/10");
    expect(formatUsage(100, 100, false)).toBe("100/100");
  });

  it("returns just used count for unlimited plans", () => {
    expect(formatUsage(50, -1, true)).toBe("50");
    expect(formatUsage(0, -1, true)).toBe("0");
  });
});

function makeRun(overrides: Partial<Run> & { id: string }): Run {
  return {
    repoOwner: "owner",
    repoName: "repo",
    issueNumber: 1,
    issueTitle: "Test issue",
    status: "success",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:05:00Z",
    ...overrides,
  };
}

describe("aggregateRepoHealth", () => {
  it("returns empty array for empty runs", () => {
    expect(aggregateRepoHealth([])).toEqual([]);
  });

  it("groups runs by repo key", () => {
    const runs = [
      makeRun({ id: "1", repoOwner: "acme", repoName: "app" }),
      makeRun({ id: "2", repoOwner: "acme", repoName: "app" }),
      makeRun({ id: "3", repoOwner: "acme", repoName: "lib" }),
    ];
    const result = aggregateRepoHealth(runs);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.repo === "acme/app")!.totalRuns).toBe(2);
    expect(result.find((r) => r.repo === "acme/lib")!.totalRuns).toBe(1);
  });

  it("counts distinct issue numbers", () => {
    const runs = [
      makeRun({ id: "1", issueNumber: 1 }),
      makeRun({ id: "2", issueNumber: 1 }),
      makeRun({ id: "3", issueNumber: 2 }),
      makeRun({ id: "4", issueNumber: 3 }),
    ];
    const result = aggregateRepoHealth(runs);
    expect(result[0].issuesCreated).toBe(3);
  });

  it("counts pending (queued + running)", () => {
    const runs = [
      makeRun({ id: "1", status: "queued" }),
      makeRun({ id: "2", status: "running" }),
      makeRun({ id: "3", status: "success" }),
    ];
    const result = aggregateRepoHealth(runs);
    expect(result[0].pending).toBe(2);
    expect(result[0].done).toBe(1);
  });

  it("counts bugs (failed status)", () => {
    const runs = [
      makeRun({ id: "1", status: "failed", errorMessage: "timeout" }),
      makeRun({ id: "2", status: "failed", errorMessage: "build error" }),
      makeRun({ id: "3", status: "success" }),
    ];
    const result = aggregateRepoHealth(runs);
    expect(result[0].bugsDetected).toBe(2);
    expect(result[0].failedRuns).toHaveLength(2);
    expect(result[0].failedRuns[0].id).toBe("1");
    expect(result[0].failedRuns[0].errorMessage).toBe("timeout");
  });

  it("caps failedRuns at 3 per repo", () => {
    const runs = [
      makeRun({ id: "1", status: "failed" }),
      makeRun({ id: "2", status: "failed" }),
      makeRun({ id: "3", status: "failed" }),
      makeRun({ id: "4", status: "failed" }),
    ];
    const result = aggregateRepoHealth(runs);
    expect(result[0].bugsDetected).toBe(4);
    expect(result[0].failedRuns).toHaveLength(3);
  });

  it("computes per-repo pass rate", () => {
    const runs = [
      makeRun({ id: "1", status: "success" }),
      makeRun({ id: "2", status: "success" }),
      makeRun({ id: "3", status: "failed" }),
      makeRun({ id: "4", status: "success" }),
    ];
    const result = aggregateRepoHealth(runs);
    expect(result[0].passRate).toBe(75);
  });

  it("sets lastRunAt to the most recent run", () => {
    const runs = [
      makeRun({ id: "1", createdAt: "2025-01-01T00:00:00Z" }),
      makeRun({ id: "2", createdAt: "2025-06-15T12:00:00Z" }),
      makeRun({ id: "3", createdAt: "2025-03-10T08:00:00Z" }),
    ];
    const result = aggregateRepoHealth(runs);
    expect(result[0].lastRunAt).toBe("2025-06-15T12:00:00Z");
  });

  it("sorts by lastRunAt descending", () => {
    const runs = [
      makeRun({ id: "1", repoOwner: "a", repoName: "old", createdAt: "2025-01-01T00:00:00Z" }),
      makeRun({ id: "2", repoOwner: "b", repoName: "new", createdAt: "2025-06-15T12:00:00Z" }),
    ];
    const result = aggregateRepoHealth(runs);
    expect(result[0].repo).toBe("b/new");
    expect(result[1].repo).toBe("a/old");
  });
});

describe("evaluateProject", () => {
  function evalWith(
    runs: Run[],
    stats: DashboardStats | null,
    opts: { usedFixes?: number; monthlyLimit?: number; isUnlimited?: boolean } = {},
  ) {
    return evaluateProject({
      runs,
      stats,
      usedFixes: opts.usedFixes ?? 0,
      monthlyLimit: opts.monthlyLimit ?? 10,
      isUnlimited: opts.isUnlimited ?? false,
    });
  }

  it("returns empty verdict when no data", () => {
    const result = evalWith([], null);
    expect(result.score).toBeNull();
    expect(result.verdict).toBe("empty");
    expect(result.rubric).toHaveLength(4);
  });

  it("scores good for a healthy project", () => {
    const stats = makeStats({ passRate: 95, avgDurationSeconds: 90 });
    const runs = [
      makeRun({ id: "1", status: "success" }),
      makeRun({ id: "2", status: "success" }),
    ];
    const result = evalWith(runs, stats, { usedFixes: 2 });
    expect(result.verdict).toBe("good");
    expect(result.score).toBeGreaterThanOrEqual(85);
    const passRateItem = result.rubric.find((r) => r.id === "pass-rate");
    expect(passRateItem).toBeDefined();
    expect(passRateItem?.severity).toBe("good");
    expect(passRateItem?.evidence).toContain("95%");
  });

  it("flags high failure rate as critical with evidence", () => {
    const runs = [
      makeRun({ id: "1", status: "failed", errorMessage: "timeout" }),
      makeRun({ id: "2", status: "failed" }),
      makeRun({ id: "3", status: "success" }),
    ];
    const result = evalWith(runs, makeStats());
    const failureItem = result.rubric.find((r) => r.id === "failure-rate");
    expect(failureItem?.severity).toBe("critical");
    expect(failureItem?.value).toBeCloseTo(66.67, 1);
    expect(failureItem?.evidence).toContain("2/3");
    expect(result.actions).toContain("overview.action.createTickets");
    expect(result.score).toBeLessThan(85);
  });

  it("flags usage warning at >= 80% and critical at >= 100%", () => {
    const warning = evalWith([], makeStats(), { usedFixes: 8, monthlyLimit: 10 });
    const usageItem = warning.rubric.find((r) => r.id === "usage");
    expect(usageItem?.severity).toBe("warning");
    expect(usageItem?.evidence).toContain("8/10");

    const exhausted = evalWith([], makeStats(), { usedFixes: 10, monthlyLimit: 10 });
    expect(exhausted.rubric.find((r) => r.id === "usage")?.severity).toBe("critical");
    expect(exhausted.actions).toContain("overview.action.checkUsage");
  });

  it("treats unlimited plans as good usage regardless of count", () => {
    const result = evalWith([], makeStats(), { usedFixes: 500, monthlyLimit: 999_999, isUnlimited: true });
    expect(result.rubric.find((r) => r.id === "usage")?.severity).toBe("good");
  });

  it("weights pass rate into the verdict", () => {
    const lowPass = evalWith(
      [makeRun({ id: "1", status: "failed" })],
      makeStats({ passRate: 20, avgDurationSeconds: 120 }),
      { usedFixes: 1 },
    );
    expect(lowPass.verdict).toBe("critical");
    expect(lowPass.rubric.find((r) => r.id === "pass-rate")?.severity).toBe("critical");
  });
});

describe("computeFeedbackLoop", () => {
  function evalWithStats(stats: DashboardStats | null, runs: Run[] = []) {
    return evaluateProject({ runs, stats, usedFixes: 0, monthlyLimit: 10, isUnlimited: false });
  }

  it("returns empty when there is no previous snapshot", () => {
    const current = evalWithStats(makeStats());
    expect(computeFeedbackLoop(null, current)).toEqual([]);
  });

  it("marks improved when pass rate rises", () => {
    const previous = evalWithStats(makeStats({ passRate: 50, avgDurationSeconds: 120 }));
    const current = evalWithStats(makeStats({ passRate: 90, avgDurationSeconds: 120 }));
    const deltas = computeFeedbackLoop(previous, current);
    const passDelta = deltas.find((d) => d.id === "pass-rate");
    expect(passDelta?.trend).toBe("improved");
    expect(passDelta?.before).toBe(50);
    expect(passDelta?.after).toBe(90);
  });

  it("marks regressed when speed worsens (lower is better)", () => {
    const previous = evalWithStats(makeStats({ passRate: 90, avgDurationSeconds: 120 }));
    const current = evalWithStats(makeStats({ passRate: 90, avgDurationSeconds: 600 }));
    const deltas = computeFeedbackLoop(previous, current);
    expect(deltas.find((d) => d.id === "speed")?.trend).toBe("regressed");
  });

  it("marks unchanged when values stay the same", () => {
    const previous = evalWithStats(makeStats({ passRate: 90, avgDurationSeconds: 120 }));
    const current = evalWithStats(makeStats({ passRate: 90, avgDurationSeconds: 120 }));
    const deltas = computeFeedbackLoop(previous, current);
    expect(deltas.find((d) => d.id === "pass-rate")?.trend).toBe("unchanged");
  });

  it("marks new when the previous snapshot had no value", () => {
    const previous = evalWithStats(null);
    const current = evalWithStats(makeStats({ passRate: 90, avgDurationSeconds: 120 }));
    const deltas = computeFeedbackLoop(previous, current);
    expect(deltas.find((d) => d.id === "pass-rate")?.trend).toBe("new");
  });
});
