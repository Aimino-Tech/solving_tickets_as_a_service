/**
 * Unit tests for src/monitoring/sloReporter.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));
vi.mock('../../bridge/metrics.js', () => ({ bridgeMetrics: { setGauge: vi.fn() } }));
describe('sloReporter', () => {
  let m: typeof import('../../monitoring/sloReporter.js');
  beforeEach(async () => { vi.clearAllMocks(); m = await import('../../monitoring/sloReporter.js'); });
  it('creates instance', () => { expect(new m.SloReporter()).toBeInstanceOf(m.SloReporter); });
  it('singleton', () => { expect(m.getSloReporter()).toBe(m.getSloReporter()); });
  it('record+report', () => { const r = new m.SloReporter(); r.recordPhase('w',150,true,false); r.recordPhase('r',5000,true,true); r.recordPhase('c',2000,true,false); const rp=r.generateDailyReport(); expect(rp.phases).toHaveLength(3); expect(rp.overallStatus).toBe('passing'); });
  it('err budget breach', () => { const r=new m.SloReporter({errorBudgetTarget:0.1}); for(let i=0;i<3;i++) r.recordPhase('r',100,false,false); for(let i=0;i<2;i++) r.recordPhase('r',300,true,true); expect(r.generateDailyReport().phases.find(p=>p.phase==='r')!.statuses.phase_error_budget).toBe('breached'); });
  it('low fix rate', () => { const r=new m.SloReporter({fixRateTarget:0.8}); for(let i=0;i<9;i++) r.recordPhase('r',1000,true,false); r.recordPhase('r',1000,true,true); expect(r.generateDailyReport().phases.find(p=>p.phase==='r')!.statuses.phase_fix_rate).toBe('breached'); });
  it('latency breach', () => { const r=new m.SloReporter({latencyTargetMs:1000}); r.recordPhase('w',5000,true,false); r.recordPhase('w',6000,true,false); expect(r.generateDailyReport().phases.find(p=>p.phase==='w')!.statuses.phase_latency_ms).toBe('breached'); });
  it('at risk', () => { const r=new m.SloReporter({latencyTargetMs:1000}); r.recordPhase('r',1100,true,true); r.recordPhase('r',1150,true,true); expect(r.generateDailyReport().overallStatus).toBe('at_risk'); });
  it('fail+fix', () => { const r=new m.SloReporter(); r.recordFailure('t',100); r.recordFix('t',200); const rp=r.generateDailyReport(); expect(rp.phases.find(p=>p.phase==='t')!.metrics.phase_error_budget).toBe(0.5); expect(rp.phases.find(p=>p.phase==='t')!.metrics.phase_fix_rate).toBe(0.5); });
  it('defs', () => { expect(m.PHASE_SLI_DEFINITIONS).toHaveLength(3); });
  it('empty', () => { expect(new m.SloReporter().generateDailyReport().phases).toHaveLength(0); });
});
