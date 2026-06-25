import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../frontier/score.js', () => ({
  recordScore: vi.fn(),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Import after mocks are set up
let pipeline: typeof import('../../frontier/pipeline.js');
let types: typeof import('../../frontier/types.js');

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-task',
    repoUrl: 'https://github.com/owner/repo',
    description: 'Fix the bug',
    timeoutMs: 60000,
    tokenBudget: { opencode: 1000 },
    ...overrides,
  } as import('../../frontier/types.js').FrontierTask;
}

function makeConfig() {
  return {
    aetherCommand: { baseUrl: 'http://aether:3000', timeoutMs: 30000 },
    opencode: { baseUrl: 'http://opencode:4096', timeoutMs: 120000 },
    defaultTimeoutMs: 60000,
    maxRetries: 1,
  } as import('../../frontier/types.js').FrontierConfig;
}

function mockOk(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) };
}

function mockError(status: number, text: string) {
  return { ok: false, status, text: () => Promise.resolve(text) };
}

describe('frontier/pipeline', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    pipeline = await import('../../frontier/pipeline.js');
    types = await import('../../frontier/types.js');
  });

  it('completes all stages successfully', async () => {
    fetchMock
      .mockResolvedValueOnce(mockOk({ language: 'ts', framework: 'node', testFramework: 'vitest', deps: [], fileCount: 10, sloc: 500, hasDockerfile: false, hasCiConfig: true }))
      .mockResolvedValueOnce(mockOk({ subtasks: ['fix test'], estimatedComplexity: 'medium', requiredFiles: ['src/test.ts'], testFiles: ['test/test.ts'], dependencies: [] }))
      .mockResolvedValueOnce(mockOk([{ id: 's1', description: 'Fix the test', approach: 'Update assertion', expectedDifficulty: 3 }]))
      .mockResolvedValueOnce(mockOk([{ id: 'c1', strategyId: 's1', files: [{ path: 'src/test.ts', content: 'fixed' }], testResults: { passed: 5, failed: 0, skipped: 0, total: 5, output: 'PASS' }, score: 0.9, durationMs: 500 }]))
      .mockResolvedValueOnce(mockOk({ candidateId: 'c1', verifierScores: [1, 1, 0.8], aggregateScore: 0.93, issues: [], passed: true }))
      .mockResolvedValueOnce(mockOk([{ id: 'c1', strategyId: 's1', files: [{ path: 'src/test.ts', content: 'fixed' }], testResults: { passed: 5, failed: 0, skipped: 0, total: 5, output: 'PASS' }, score: 0.95, durationMs: 500 }]))
      .mockResolvedValueOnce(mockOk({ status: 'submitted' }));

    const events: unknown[] = [];
    const result = await pipeline.runPipeline(makeTask(), makeConfig(), (e) => events.push(e));
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.completedStages).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('handles stage failure with retry', async () => {
    fetchMock
      .mockResolvedValueOnce(mockOk({ language: 'ts', framework: 'node', testFramework: 'vitest', deps: [], fileCount: 10, sloc: 500, hasDockerfile: false, hasCiConfig: true }))
      .mockResolvedValueOnce(mockOk({ subtasks: ['fix test'], estimatedComplexity: 'medium', requiredFiles: ['src/test.ts'], testFiles: ['test/test.ts'], dependencies: [] }))
      .mockResolvedValueOnce(mockError(500, 'Internal error'))
      .mockResolvedValueOnce(mockOk({ stage: 'generate', error: 'API error', rootCause: 'timeout', suggestedFix: 'Retry', retryable: true }))
      .mockResolvedValueOnce(mockOk([{ id: 's1', description: 'Strategy', approach: 'Fix', expectedDifficulty: 3 }]))
      .mockResolvedValueOnce(mockOk([{ id: 'c1', strategyId: 's1', files: [{ path: 'src/test.ts', content: 'fixed' }], testResults: { passed: 1, failed: 0, skipped: 0, total: 1, output: 'OK' }, score: 0.8, durationMs: 100 }]))
      .mockResolvedValueOnce(mockOk({ candidateId: 'c1', verifierScores: [1], aggregateScore: 1, issues: [], passed: true }))
      .mockResolvedValueOnce(mockOk([{ id: 'c1', strategyId: 's1', files: [{ path: 'src/test.ts', content: 'fixed' }], testResults: { passed: 1, failed: 0, skipped: 0, total: 1, output: 'OK' }, score: 0.8, durationMs: 100 }]))
      .mockResolvedValueOnce(mockOk({ status: 'submitted' }));

    const result = await pipeline.runPipeline(makeTask({ description: 'Fix bug' }), makeConfig());
    expect(result.score).toBeGreaterThan(0);
    expect(result.completedStages).toBeGreaterThan(0);
  });

  it('fails pipeline when non-retryable error occurs', async () => {
    fetchMock
      .mockResolvedValueOnce(mockError(500, 'Fingerprint failed'))
      .mockResolvedValueOnce(mockOk({ stage: 'fingerprint', error: 'API error', rootCause: 'bad request', suggestedFix: 'Fix input', retryable: false }));

    const result = await pipeline.runPipeline(makeTask({ description: 'Test' }), makeConfig());
    expect(result.passed).toBe(false);
    expect(result.completedStages).toBe(0);
  });

  it('emits progress events during pipeline execution', async () => {
    fetchMock.mockResolvedValue(mockOk({ status: 'ok' }));

    const events: import('../../frontier/types.js').PipelineEvent[] = [];
    await pipeline.runPipeline(makeTask({ description: 'Test' }), makeConfig(), (e) => events.push(e));

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'progress')).toBe(true);
    expect(events.some((e) => e.type === 'complete')).toBe(true);
  });

  it('respects task timeout', async () => {
    fetchMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(mockOk({})), 5000)));

    const task = makeTask({ description: 'Slow test', timeoutMs: 50 });
    const result = await pipeline.runPipeline(task, makeConfig());
    expect(result.passed).toBe(false);
  }, 10000);
});
