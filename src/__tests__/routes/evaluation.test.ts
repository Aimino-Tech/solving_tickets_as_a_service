import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));
vi.mock('../../evaluation/lighthouseRunner.js', () => ({
  getLighthouseEvaluation: vi.fn(() => ({ lastRunAt: null, evaluation: null, feedback: [] })),
  runLighthouseSweep: vi.fn(),
}));
vi.mock('../../auth/middleware.js', () => ({
  requireAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

import { evaluationRouter } from '../../routes/evaluation.js';

type RouteInfo = {
  path: string;
  methods: Record<string, boolean>;
};

function registeredRoutes(router: unknown): RouteInfo[] {
  const stack =
    (router as { stack?: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack ?? [];
  return stack
    .map((layer) => layer.route)
    .filter((route): route is { path: string; methods: Record<string, boolean> } => Boolean(route))
    .map((route) => ({ path: route.path, methods: route.methods }));
}

describe('routes/evaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports evaluationRouter', () => {
    expect(evaluationRouter).toBeDefined();
    expect(typeof evaluationRouter.get).toBe('function');
    expect(typeof evaluationRouter.post).toBe('function');
  });

  it('registers GET /lighthouse and POST /lighthouse/run', () => {
    const routes = registeredRoutes(evaluationRouter);
    const lighthouseGet = routes.find((r) => r.path === '/lighthouse' && r.methods.get);
    const lighthouseRun = routes.find((r) => r.path === '/lighthouse/run' && r.methods.post);
    expect(lighthouseGet).toBeDefined();
    expect(lighthouseRun).toBeDefined();
  });
});
