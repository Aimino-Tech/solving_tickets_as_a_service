import type { ScoreEntry, FrontierStatus } from './types.js';

const MAX_RECENT_TASKS = 100;

const scoreHistory: ScoreEntry[] = [];

export function recordScore(entry: ScoreEntry): void {
  scoreHistory.push(entry);
  if (scoreHistory.length > MAX_RECENT_TASKS) {
    scoreHistory.shift();
  }
}

export function getFrontierStatus(): FrontierStatus {
  const totalTasks = scoreHistory.length;
  if (totalTasks === 0) {
    return {
      totalTasks: 0,
      passedTasks: 0,
      failedTasks: 0,
      passRate: 0,
      averageScore: 0,
      scoreDistribution: [],
      totalCost: {},
      blockerFrequency: {},
      recentTasks: [],
    };
  }

  const passedTasks = scoreHistory.filter((e) => e.passed).length;
  const passRate = passedTasks / totalTasks;
  const averageScore = scoreHistory.reduce((sum, e) => sum + e.score, 0) / totalTasks;

  const buckets = new Array(10).fill(0);
  for (const entry of scoreHistory) {
    const idx = Math.min(Math.floor(entry.score * 10), 9);
    buckets[idx]++;
  }

  const totalCost: Record<string, number> = {};
  const blockerFrequency: Record<string, number> = {};
  for (const entry of scoreHistory) {
    for (const [key, val] of Object.entries(entry.cost)) {
      totalCost[key] = (totalCost[key] ?? 0) + val;
    }
    for (const blocker of entry.blockers) {
      blockerFrequency[blocker] = (blockerFrequency[blocker] ?? 0) + 1;
    }
  }

  return {
    totalTasks,
    passedTasks,
    failedTasks: totalTasks - passedTasks,
    passRate,
    averageScore,
    scoreDistribution: buckets,
    totalCost,
    blockerFrequency,
    recentTasks: [...scoreHistory].reverse().slice(0, 20),
  };
}

export function getScoreHistory(): ScoreEntry[] {
  return [...scoreHistory];
}

export function resetScores(): void {
  scoreHistory.length = 0;
}

export function getTaskScore(taskId: string): ScoreEntry | undefined {
  return scoreHistory.find((e) => e.taskId === taskId);
}
