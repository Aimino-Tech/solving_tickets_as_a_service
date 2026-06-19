import { describe, expect, it, beforeEach } from 'vitest';

describe('frontier/score', () => {
  let score: typeof import('../../frontier/score.js');

  beforeEach(async () => {
    score = await import('../../frontier/score.js');
    score.resetScores();
  });

  it('returns empty status when no scores recorded', () => {
    const status = score.getFrontierStatus();
    expect(status.totalTasks).toBe(0);
    expect(status.passRate).toBe(0);
  });

  it('records a score entry and updates status', () => {
    score.recordScore({
      taskId: 'task-1', passed: true, score: 1.0, durationMs: 1000,
      stagesCompleted: 7, totalStages: 7, cost: {}, blockers: [], timestamp: Date.now(),
    });
    const status = score.getFrontierStatus();
    expect(status.totalTasks).toBe(1);
    expect(status.passedTasks).toBe(1);
    expect(status.passRate).toBe(1);
    expect(status.averageScore).toBe(1);
  });

  it('tracks pass rate across multiple tasks', () => {
    score.recordScore({
      taskId: 'task-1', passed: true, score: 1.0, durationMs: 500,
      stagesCompleted: 7, totalStages: 7, cost: {}, blockers: [], timestamp: Date.now(),
    });
    score.recordScore({
      taskId: 'task-2', passed: false, score: 0.3, durationMs: 300,
      stagesCompleted: 2, totalStages: 7, cost: {}, blockers: ['timeout'], timestamp: Date.now(),
    });
    score.recordScore({
      taskId: 'task-3', passed: true, score: 0.9, durationMs: 800,
      stagesCompleted: 6, totalStages: 7, cost: {}, blockers: [], timestamp: Date.now(),
    });

    const status = score.getFrontierStatus();
    expect(status.totalTasks).toBe(3);
    expect(status.passedTasks).toBe(2);
    expect(status.failedTasks).toBe(1);
    expect(status.passRate).toBeCloseTo(2 / 3);
  });

  it('tracks blocker frequency', () => {
    score.recordScore({
      taskId: 'task-1', passed: false, score: 0, durationMs: 100,
      stagesCompleted: 0, totalStages: 7, cost: {}, blockers: ['compile error', 'timeout'], timestamp: Date.now(),
    });
    score.recordScore({
      taskId: 'task-2', passed: false, score: 0, durationMs: 200,
      stagesCompleted: 1, totalStages: 7, cost: {}, blockers: ['compile error'], timestamp: Date.now(),
    });

    const status = score.getFrontierStatus();
    expect(status.blockerFrequency['compile error']).toBe(2);
    expect(status.blockerFrequency['timeout']).toBe(1);
  });

  it('tracks cost per stage', () => {
    score.recordScore({
      taskId: 'task-1', passed: true, score: 1, durationMs: 500,
      stagesCompleted: 7, totalStages: 7, cost: { opencode: 150, aether: 50 }, blockers: [], timestamp: Date.now(),
    });
    score.recordScore({
      taskId: 'task-2', passed: true, score: 1, durationMs: 400,
      stagesCompleted: 7, totalStages: 7, cost: { opencode: 100, aether: 30 }, blockers: [], timestamp: Date.now(),
    });

    const status = score.getFrontierStatus();
    expect(status.totalCost['opencode']).toBe(250);
    expect(status.totalCost['aether']).toBe(80);
  });

  it('returns score distribution across 10 buckets', () => {
    const tasks = [
      { taskId: 't1', score: 0.05, passed: false },
      { taskId: 't2', score: 0.15, passed: false },
      { taskId: 't3', score: 0.35, passed: false },
      { taskId: 't4', score: 0.55, passed: false },
      { taskId: 't5', score: 0.85, passed: false },
      { taskId: 't6', score: 0.95, passed: true },
    ];
    for (const t of tasks) {
      score.recordScore({
        taskId: t.taskId, passed: t.passed, score: t.score, durationMs: 100,
        stagesCompleted: Math.ceil(t.score * 7), totalStages: 7,
        cost: {}, blockers: [], timestamp: Date.now(),
      });
    }

    const status = score.getFrontierStatus();
    const nonEmptyBuckets = status.scoreDistribution.filter((b) => b > 0);
    expect(nonEmptyBuckets.length).toBeGreaterThanOrEqual(4);
  });

  it('getScoreHistory returns all entries', () => {
    score.recordScore({
      taskId: 'task-1', passed: true, score: 1, durationMs: 500,
      stagesCompleted: 7, totalStages: 7, cost: {}, blockers: [], timestamp: 1000,
    });
    score.recordScore({
      taskId: 'task-2', passed: false, score: 0, durationMs: 300,
      stagesCompleted: 0, totalStages: 7, cost: {}, blockers: [], timestamp: 2000,
    });
    const history = score.getScoreHistory();
    expect(history).toHaveLength(2);
  });

  it('getTaskScore returns specific task', () => {
    score.recordScore({
      taskId: 'find-me', passed: true, score: 1, durationMs: 100,
      stagesCompleted: 7, totalStages: 7, cost: {}, blockers: [], timestamp: Date.now(),
    });
    const entry = score.getTaskScore('find-me');
    expect(entry).toBeDefined();
    expect(entry!.passed).toBe(true);
  });

  it('getTaskScore returns undefined for unknown task', () => {
    const entry = score.getTaskScore('unknown');
    expect(entry).toBeUndefined();
  });

  it('caps recent tasks at 20', () => {
    for (let i = 0; i < 30; i++) {
      score.recordScore({
        taskId: `task-${i}`, passed: true, score: 1, durationMs: 100,
        stagesCompleted: 7, totalStages: 7, cost: {}, blockers: [], timestamp: i,
      });
    }
    expect(score.getScoreHistory().length).toBe(30);
    expect(score.getFrontierStatus().recentTasks.length).toBe(20);
  });
});
