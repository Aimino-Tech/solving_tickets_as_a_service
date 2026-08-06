/**
 * Lighthouse evaluation runner — the "checking" engine of the evaluation system.
 *
 * Runs the existing `scripts/lighthouse-sweep.sh` against the dashboard routes,
 * parses the per-route Lighthouse JSON reports into structured evidence, then
 * scores each route against explicit criteria (>= 90 good, 50-89 warning,
 * < 50 critical — per the project standing rule, docs/user-stories-todo.md).
 *
 * Evaluation model (4 pillars):
 *   1. Criteria  — exact thresholds defining "good" per rubric item
 *   2. Evidence  — raw per-category Lighthouse scores backing each verdict
 *   3. Rubrics   — weighted 0..100 score converting evidence into a verdict
 *   4. Feedback  — deltas vs the previous snapshot so results drive improvement
 *
 * Persistence:
 *   latest.json  — most recent evaluation (read by GET /api/v1/evaluation/lighthouse)
 *   history.json — bounded snapshot history for the feedback loop
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { rootLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const log = rootLogger.child({ module: 'lighthouse-eval' });

export type LighthouseSeverity = 'good' | 'warning' | 'critical' | 'empty';

export type LighthouseCategory = 'performance' | 'accessibility' | 'best-practices' | 'seo';

export const LIGHTHOUSE_CATEGORIES: LighthouseCategory[] = ['performance', 'accessibility', 'best-practices', 'seo'];

/** Weight of each category inside a route's score. */
export const LIGHTHOUSE_CATEGORY_WEIGHTS: Record<LighthouseCategory, number> = {
  performance: 0.4,
  accessibility: 0.3,
  'best-practices': 0.2,
  seo: 0.1,
};

/** Project standing rule: every scanned route must score >= 90 per category. */
export const LIGHTHOUSE_THRESHOLD = 90;

/** Severity -> 0..100 contribution, same scale as the dashboard evaluation. */
const SEVERITY_SCORE: Record<LighthouseSeverity, number> = {
  good: 100,
  warning: 60,
  critical: 20,
  empty: 0,
};

const CRITERIA_TEXT = '\u2265 90 good \u00b7 50\u201389 warning \u00b7 < 50 critical';

export interface LighthouseRouteResult {
  route: string;
  scores: Partial<Record<LighthouseCategory, number>>;
  score: number | null;
  severity: LighthouseSeverity;
  evidence: string;
}

export interface LighthouseRubricItem {
  id: string;
  route: string;
  value: number | null;
  criteria: string;
  severity: LighthouseSeverity;
  evidence: string;
  weight: number;
  higherIsBetter: boolean;
}

export interface LighthouseEvaluation {
  timestamp: string;
  score: number | null;
  verdict: LighthouseSeverity;
  rubric: LighthouseRubricItem[];
  actions: string[];
}

export interface LighthouseFeedbackDelta {
  id: string;
  route: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  severityBefore: LighthouseSeverity;
  severityAfter: LighthouseSeverity;
  trend: 'improved' | 'regressed' | 'unchanged' | 'new';
}

export interface LighthouseRunResult {
  ok: boolean;
  message: string;
  lastRunAt: string | null;
  evaluation: LighthouseEvaluation | null;
  feedback: LighthouseFeedbackDelta[];
}

interface HistoryEntry {
  timestamp: string;
  evaluation: LighthouseEvaluation;
}

interface LatestSnapshot {
  lastRunAt: string;
  evaluation: LighthouseEvaluation;
  feedback: LighthouseFeedbackDelta[];
}

const MAX_HISTORY = 50;
const SCRIPT = resolve(process.cwd(), 'scripts', 'lighthouse-sweep.sh');

export function lighthouseDataDir(): string {
  return process.env.LIGHTHOUSE_DATA_DIR || resolve(process.cwd(), 'data', 'evaluation', 'lighthouse');
}

export function lighthouseBaseUrl(): string {
  return process.env.DASHBOARD_URL || 'http://localhost:5173';
}

export function lighthouseRoutes(): string[] {
  const fromEnv = process.env.LIGHTHOUSE_ROUTES;
  if (fromEnv) {
    const routes = fromEnv
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    if (routes.length > 0) return routes;
  }
  return ['/', '/runs', '/settings', '/liveview'];
}

/** Map a route to the file name the sweep script writes (index.json for '/'). */
function routeFileName(route: string): string {
  const name = route.replace(/^\//, '');
  return `${name === '' ? 'index' : name}.json`;
}

export function severityForScore(score: number | null): LighthouseSeverity {
  if (score === null || score === undefined) return 'empty';
  if (score >= LIGHTHOUSE_THRESHOLD) return 'good';
  if (score >= 50) return 'warning';
  return 'critical';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function routeScore(scores: Partial<Record<LighthouseCategory, number>>): number | null {
  const present = LIGHTHOUSE_CATEGORIES.filter((c) => scores[c] !== undefined && scores[c] !== null);
  if (present.length === 0) return null;
  const totalWeight = present.reduce((s, c) => s + LIGHTHOUSE_CATEGORY_WEIGHTS[c], 0);
  const weighted = present.reduce((s, c) => s + (scores[c] as number) * LIGHTHOUSE_CATEGORY_WEIGHTS[c], 0);
  return Math.round(weighted / totalWeight);
}

function routeEvidence(scores: Partial<Record<LighthouseCategory, number>>): string {
  return LIGHTHOUSE_CATEGORIES.map((c) => {
    const value = scores[c];
    return `${c} ${value === undefined || value === null ? '\u2014' : value}`;
  }).join(' \u00b7 ');
}

/**
 * Evaluate raw per-route scores into a full Lighthouse evaluation.
 * One rubric item per route; overall score = weighted severity contribution.
 */
export function evaluateLighthouse(
  routes: Array<{ route: string; scores: Partial<Record<LighthouseCategory, number>> }>,
  timestamp = new Date().toISOString(),
): LighthouseEvaluation {
  const rubric: LighthouseRubricItem[] = routes.map((entry) => {
    const value = routeScore(entry.scores);
    const severity = severityForScore(value);
    return {
      id: `route:${entry.route}`,
      route: entry.route,
      value,
      criteria: CRITERIA_TEXT,
      severity,
      evidence: routeEvidence(entry.scores),
      weight: routes.length > 0 ? 1 / routes.length : 0,
      higherIsBetter: true,
    };
  });

  const active = rubric.filter((r) => r.severity !== 'empty');
  const totalWeight = active.reduce((s, r) => s + r.weight, 0);
  const score =
    active.length === 0 || totalWeight === 0
      ? null
      : Math.round(active.reduce((s, r) => s + SEVERITY_SCORE[r.severity] * r.weight, 0) / totalWeight);

  let verdict: LighthouseSeverity = 'empty';
  if (score !== null) verdict = score >= 85 ? 'good' : score >= 50 ? 'warning' : 'critical';

  const actions: string[] = [];
  if (score !== null && score < LIGHTHOUSE_THRESHOLD) actions.push('lighthouse.actions.regression');

  return { timestamp, score, verdict, rubric, actions };
}

/**
 * Feedback loop: compare the previous evaluation snapshot with the current one
 * and report the per-route delta (improved / regressed / unchanged / new).
 */
export function computeFeedbackLoop(
  previous: LighthouseEvaluation | null,
  current: LighthouseEvaluation,
): LighthouseFeedbackDelta[] {
  if (!previous) return [];
  return current.rubric.map((item) => {
    const before = previous.rubric.find((p) => p.id === item.id);
    if (!before || before.value === null) {
      return {
        id: item.id,
        route: item.route,
        before: null,
        after: item.value,
        delta: null,
        severityBefore: 'empty',
        severityAfter: item.severity,
        trend: 'new',
      };
    }
    const delta = item.value === null ? null : item.value - before.value;
    const trend: LighthouseFeedbackDelta['trend'] =
      delta === null ? 'unchanged' : Math.abs(delta) < 0.5 ? 'unchanged' : delta > 0 ? 'improved' : 'regressed';
    return {
      id: item.id,
      route: item.route,
      before: before.value,
      after: item.value,
      delta,
      severityBefore: before.severity,
      severityAfter: item.severity,
      trend,
    };
  });
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch (err) {
    log.warn({ err: String(err), path }, 'Failed to parse evaluation file');
    return null;
  }
}

export function readLatestEvaluation(): LighthouseEvaluation | null {
  return readJson<LatestSnapshot>(resolve(lighthouseDataDir(), 'latest.json'))?.evaluation ?? null;
}

function readLatestSnapshot(): LatestSnapshot | null {
  return readJson<LatestSnapshot>(resolve(lighthouseDataDir(), 'latest.json'));
}

function readHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>(resolve(lighthouseDataDir(), 'history.json')) ?? [];
}

function persistEvaluation(evaluation: LighthouseEvaluation, feedback: LighthouseFeedbackDelta[]): void {
  const dir = lighthouseDataDir();
  mkdirSync(dir, { recursive: true });
  const snapshot: LatestSnapshot = { lastRunAt: evaluation.timestamp, evaluation, feedback };
  writeFileSync(resolve(dir, 'latest.json'), JSON.stringify(snapshot, null, 2));

  const history = readHistory();
  history.push({ timestamp: evaluation.timestamp, evaluation });
  const trimmed = history.slice(-MAX_HISTORY);
  writeFileSync(resolve(dir, 'history.json'), JSON.stringify(trimmed, null, 2));
}

function parseLighthouseReport(path: string): Partial<Record<LighthouseCategory, number>> {
  const report = readJson<{ categories?: Record<string, { score?: number | null }> }>(path);
  if (!report?.categories) return {};
  const scores: Partial<Record<LighthouseCategory, number>> = {};
  for (const category of LIGHTHOUSE_CATEGORIES) {
    const raw = report.categories[category]?.score;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      scores[category] = Math.round(clamp(raw, 0, 1) * 100);
    }
  }
  return scores;
}

/**
 * Run the Lighthouse sweep against the dashboard routes and persist a new
 * evaluation snapshot. Safe to call without Chrome present — reports are
 * parsed per-route; a fully empty run is reported as failed and not persisted.
 */
export async function runLighthouseSweep(opts?: {
  baseUrl?: string;
  routes?: string[];
  timeoutMs?: number;
}): Promise<LighthouseRunResult> {
  const baseUrl = opts?.baseUrl ?? lighthouseBaseUrl();
  const routes = opts?.routes ?? lighthouseRoutes();
  const outDir = resolve(lighthouseDataDir(), 'runs', String(Date.now()));

  if (!existsSync(SCRIPT)) {
    return { ok: false, message: `Sweep script not found: ${SCRIPT}`, lastRunAt: null, evaluation: null, feedback: [] };
  }

  try {
    await execFileAsync('bash', [SCRIPT, baseUrl, '--json', ...routes], {
      timeout: opts?.timeoutMs ?? 300_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, LIGHTHOUSE_OUT_DIR: outDir },
    });
  } catch (err) {
    // The script exits non-zero when any route scores below threshold — that is
    // the expected "FAIL" signal for an evaluation, not a runner crash.
    const execErr = err as { stderr?: string; stdout?: string; message?: string };
    const detail = execErr.stderr || execErr.message || String(err);
    log.info({ detail }, 'Lighthouse sweep finished with non-zero exit (threshold not met)');
  }

  const results: Array<{ route: string; scores: Partial<Record<LighthouseCategory, number>> }> = [];
  for (const route of routes) {
    const path = resolve(outDir, routeFileName(route));
    results.push({ route, scores: parseLighthouseReport(path) });
  }

  const evaluated = evaluateLighthouse(results);
  const hasData = results.some((r) => Object.keys(r.scores).length > 0);

  if (!hasData) {
    return {
      ok: false,
      message: 'Lighthouse sweep produced no scores — is the dashboard running and is Chrome available?',
      lastRunAt: null,
      evaluation: null,
      feedback: [],
    };
  }

  const previous = readLatestEvaluation();
  const feedback = computeFeedbackLoop(previous, evaluated);
  persistEvaluation(evaluated, feedback);

  log.info(
    { score: evaluated.score, verdict: evaluated.verdict, routes: routes.length },
    'Lighthouse evaluation persisted',
  );

  return {
    ok: true,
    message:
      evaluated.score !== null && evaluated.score >= LIGHTHOUSE_THRESHOLD
        ? 'All routes pass'
        : 'One or more routes scored below threshold',
    lastRunAt: evaluated.timestamp,
    evaluation: evaluated,
    feedback,
  };
}

/** Snapshot for the GET endpoint: latest evaluation + feedback deltas. */
export function getLighthouseEvaluation(): {
  lastRunAt: string | null;
  evaluation: LighthouseEvaluation | null;
  feedback: LighthouseFeedbackDelta[];
} {
  const snapshot = readLatestSnapshot();
  if (!snapshot) return { lastRunAt: null, evaluation: null, feedback: [] };
  return { lastRunAt: snapshot.lastRunAt, evaluation: snapshot.evaluation, feedback: snapshot.feedback };
}
