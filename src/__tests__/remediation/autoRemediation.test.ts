import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() })) } }));
vi.mock('../../config.js', () => ({ config: { stas: { remediation: { disabled: false } } } }));
describe('RemediationEngine', () => {
  let engine: any, store: any, RemediationEngine: any, RemediationStore: any, createDefaultRemediations: any;
  beforeEach(async () => {
    vi.clearAllMocks(); const ar = await import('../../remediation/autoRemediation.js'); const rs = await import('../../remediation/remediationStore.js');
    ar.resetRemediationEngine(); RemediationEngine = ar.RemediationEngine; RemediationStore = rs.RemediationStore; createDefaultRemediations = ar.createDefaultRemediations;
    store = new RemediationStore(); engine = new RemediationEngine(store); engine.registerAll(createDefaultRemediations());
  });
  it('evaluates and triggers QueueScaleUp', async () => {
    const t = await engine.evaluate({ alertId: 't1', reason: 'test', metadata: { queueDepth: 150 } });
    expect(t.length).toBeGreaterThanOrEqual(1); expect(t.map((r: any) => r.name)).toContain('QueueScaleUp');
  });
  it('returns empty when nothing matches', async () => {
    const t = await engine.evaluate({ alertId: 't2', reason: 'fine', metadata: { queueDepth: 10, workerCount: 5, connectionUtilization: 0.3 } });
    expect(t).toHaveLength(0);
  });
  it('skips when disabled', async () => {
    engine.setDisabled(true); const t = await engine.evaluate({ alertId: 't3', reason: 'x', metadata: { queueDepth: 200 } });
    expect(t).toHaveLength(0);
  });
  it('executes and audits', async () => {
    const { QueueScaleUpRemediation } = await import('../../remediation/autoRemediation.js');
    const a = new QueueScaleUpRemediation(); engine.register(a);
    const r = await engine.execute(a, { alertId: 't4', reason: 'x', metadata: { queueDepth: 150 } });
    expect(r.success).toBe(true); expect(r.action).toBe('QueueScaleUp');
    expect((await store.list({ action: 'QueueScaleUp' }))[0].status).toBe('success');
  });
  it('audits execution errors', async () => {
    const fa = { name: 'Failer', description: '', cooldownMs: 0, evaluate: () => true, execute: async () => { throw new Error('Oops'); } };
    engine.register(fa); const r = await engine.execute(fa, { alertId: 't5', reason: 'x' });
    expect(r.success).toBe(false); expect(r.message).toContain('Oops');
    expect((await store.list({ action: 'Failer' }))[0].status).toBe('error');
  });
  it('circuit breaker opens after 3 failures', async () => {
    const fa = { name: 'Flaky', description: '', cooldownMs: 0, evaluate: () => true, execute: async () => ({ action: 'Flaky', success: false, message: 'fail', durationMs: 10, context: { alertId: 'cb', reason: 't' } }) };
    engine.register(fa); const ctx = { alertId: 'cb', reason: 't' };
    for (let i = 0; i < 3; i++) await engine.execute(fa, ctx);
    expect((await engine.evaluate(ctx)).find((r: any) => r.name === 'Flaky')).toBeUndefined();
  });
  it('evaluateAndExecute triggers multiple', async () => {
    const r = await engine.evaluateAndExecute({ alertId: 'eae', reason: 'multi', metadata: { queueDepth: 200, workerCount: 0, connectionUtilization: 0.9 } });
    expect(r.length).toBeGreaterThanOrEqual(3);
    expect(r.map((x: any) => x.action)).toEqual(expect.arrayContaining(['QueueScaleUp', 'WorkerRestart', 'DbPoolIncrease']));
  });
});
describe('5 remediations', () => {
  it('QueueScaleUp', async () => {
    const { QueueScaleUpRemediation } = await import('../../remediation/autoRemediation.js');
    const a = new QueueScaleUpRemediation();
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { queueDepth: 101 } })).toBe(true);
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { queueDepth: 50 } })).toBe(false);
    expect((await a.execute({ alertId: 't', reason: 't' })).message).toContain('+2');
  });
  it('WorkerRestart', async () => {
    const { WorkerRestartRemediation } = await import('../../remediation/autoRemediation.js');
    const a = new WorkerRestartRemediation();
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { workerCount: 0 } })).toBe(true);
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { workerCount: 1 } })).toBe(false);
    expect((await a.execute({ alertId: 't', reason: 't' })).message).toContain('restart');
  });
  it('DbPoolIncrease', async () => {
    const { DbPoolIncreaseRemediation } = await import('../../remediation/autoRemediation.js');
    const a = new DbPoolIncreaseRemediation();
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { connectionUtilization: 0.81 } })).toBe(true);
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { connectionUtilization: 0.5 } })).toBe(false);
    expect((await a.execute({ alertId: 't', reason: 't' })).message).toContain('25%');
  });
  it('TokenRotation', async () => {
    const { TokenRotationRemediation } = await import('../../remediation/autoRemediation.js');
    const a = new TokenRotationRemediation();
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { _401Count: 6 } })).toBe(true);
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { tokenAgeHours: 49 } })).toBe(true);
    expect((await a.execute({ alertId: 't', reason: 't', metadata: { tokenType: 'GITHUB_TOKEN' } })).message).toContain('GITHUB_TOKEN');
  });
  it('AgentKill', async () => {
    const { AgentKillRemediation } = await import('../../remediation/autoRemediation.js');
    const a = new AgentKillRemediation();
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { agentRunDurationMs: 1_000_000, agentTimeoutMs: 600_000 } })).toBe(true);
    expect(a.evaluate({ alertId: 't', reason: 't', metadata: { agentRunDurationMs: 500_000, agentTimeoutMs: 600_000 } })).toBe(false);
    expect((await a.execute({ alertId: 't', reason: 't' })).message).toContain('SIGTERM');
  });
});
describe('RemediationStore', () => {
  let rs: any;
  beforeEach(async () => { const m = await import('../../remediation/remediationStore.js'); rs = new m.RemediationStore(); });
  it('records/retrieves', async () => { const id = await rs.record({ action: 'A', alertId: 'a1', reason: 'r', status: 'success', detail: 'd' }); expect(id).toBeTruthy(); expect((await rs.get(id)).action).toBe('A'); });
  it('filters/paginates', async () => { for (let i = 0; i < 5; i++) await rs.record({ action: 'A', alertId: 'a', reason: 'r', status: 'success', detail: 'd' }); expect((await rs.list({ limit: 2 })).length).toBe(2); });
  it('stats', async () => { await rs.record({ action: 'X', alertId: 'a', reason: 'r', status: 'success', detail: 'd' }); await rs.record({ action: 'Y', alertId: 'a', reason: 'r', status: 'failure', detail: 'd' }); const s = await rs.stats(); expect(s.totalEntries).toBe(2); expect(s.byAction.X).toBe(1); });
  it('prunes', async () => { await rs.record({ action: 'X', alertId: 'a', reason: 'r', status: 'success', detail: 'd', createdAt: new Date(0) }); expect(await rs.prune(100)).toBe(1); expect(rs.size).toBe(0); });
});
describe('init/get', () => {
  beforeEach(async () => { (await import('../../remediation/autoRemediation.js')).resetRemediationEngine(); });
  it('init creates singleton', async () => { const m = await import('../../remediation/autoRemediation.js'); const e = m.initRemediationEngine(); expect(e).toBeDefined(); expect(m.getRemediationEngine()).toBe(e); });
  it('throws before init', async () => { const m = await import('../../remediation/autoRemediation.js'); expect(() => m.getRemediationEngine()).toThrow(/not initialized/); });
});
