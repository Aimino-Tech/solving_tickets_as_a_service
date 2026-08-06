import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeFeedbackLoop, evaluateLighthouse, severityForScore } from '../../evaluation/lighthouseRunner.js';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

const ROUTE_SCORES = [
  { route: '/', scores: { performance: 92, accessibility: 95, 'best-practices': 100, seo: 90 } },
  { route: '/runs', scores: { performance: 70, accessibility: 85, 'best-practices': 90, seo: 80 } },
];

describe('evaluateLighthouse', () => {
  it('scores each route from weighted category evidence', () => {
    const evaluation = evaluateLighthouse(ROUTE_SCORES, '2026-08-06T10:00:00.000Z');
    expect(evaluation.rubric).toHaveLength(2);
    const home = evaluation.rubric.find((r) => r.route === '/');
    const runs = evaluation.rubric.find((r) => r.route === '/runs');
    expect(home?.value).toBe(94);
    expect(home?.severity).toBe('good');
    expect(runs?.value).toBe(80);
    expect(runs?.severity).toBe('warning');
  });

  it('exposes criteria text and per-category evidence', () => {
    const evaluation = evaluateLighthouse([ROUTE_SCORES[0]], 't');
    const item = evaluation.rubric[0];
    expect(item.criteria).toContain('90');
    expect(item.evidence).toContain('performance 92');
    expect(item.evidence).toContain('seo 90');
  });

  it('computes overall score from severity contributions and verdict', () => {
    const evaluation = evaluateLighthouse(ROUTE_SCORES, 't');
    expect(evaluation.score).toBeGreaterThanOrEqual(50);
    expect(evaluation.verdict).toBe('warning');
    expect(evaluation.actions).toContain('lighthouse.actions.regression');
  });

  it('returns empty verdict when no scores present', () => {
    const evaluation = evaluateLighthouse([{ route: '/', scores: {} }], 't');
    expect(evaluation.score).toBeNull();
    expect(evaluation.verdict).toBe('empty');
    expect(evaluation.actions).toEqual([]);
  });
});

describe('severityForScore', () => {
  it('maps thresholds to severity', () => {
    expect(severityForScore(90)).toBe('good');
    expect(severityForScore(89)).toBe('warning');
    expect(severityForScore(50)).toBe('warning');
    expect(severityForScore(49)).toBe('critical');
    expect(severityForScore(null)).toBe('empty');
  });
});

describe('computeFeedbackLoop', () => {
  const previous = evaluateLighthouse(ROUTE_SCORES, 't1');
  const current = evaluateLighthouse(
    [
      { route: '/', scores: { performance: 40, accessibility: 40, 'best-practices': 40, seo: 40 } },
      { route: '/runs', scores: { performance: 70, accessibility: 85, 'best-practices': 90, seo: 80 } },
    ],
    't2',
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when no previous snapshot', () => {
    expect(computeFeedbackLoop(null, current)).toEqual([]);
  });

  it('marks regressed routes', () => {
    const deltas = computeFeedbackLoop(previous, current);
    const home = deltas.find((d) => d.route === '/');
    expect(home?.trend).toBe('regressed');
    expect(home?.before).toBe(94);
    expect(home?.after).toBe(40);
    expect(home?.delta).toBe(-54);
    expect(home?.severityAfter).toBe('critical');
  });

  it('marks unchanged routes and new routes', () => {
    const deltas = computeFeedbackLoop(previous, current);
    const runs = deltas.find((d) => d.route === '/runs');
    expect(runs?.trend).toBe('unchanged');

    const withNewRoute = evaluateLighthouse(
      [
        ...ROUTE_SCORES,
        { route: '/settings', scores: { performance: 99, accessibility: 99, 'best-practices': 99, seo: 99 } },
      ],
      't3',
    );
    const newDeltas = computeFeedbackLoop(previous, withNewRoute);
    const settings = newDeltas.find((d) => d.route === '/settings');
    expect(settings?.trend).toBe('new');
    expect(settings?.before).toBeNull();
  });

  it('marks improved routes', () => {
    const improved = evaluateLighthouse(
      [{ route: '/', scores: { performance: 100, accessibility: 100, 'best-practices': 100, seo: 100 } }],
      't3',
    );
    const deltas = computeFeedbackLoop(previous, improved);
    const home = deltas.find((d) => d.route === '/');
    expect(home?.trend).toBe('improved');
  });
});
