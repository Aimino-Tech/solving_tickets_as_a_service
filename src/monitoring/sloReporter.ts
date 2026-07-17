/**
 * SLO Reporter — per-phase Service Level Objective compliance tracking.
 */
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';
const log = rootLogger.child({ module: 'slo-reporter' });
export type PhaseSliName = 'phase_latency_ms' | 'phase_error_budget' | 'phase_fix_rate';
export type SloStatus = 'compliant' | 'warning' | 'breached';
export interface PhaseSliDefinition {
  name: PhaseSliName; description: string; target: number; operator: 'lt' | 'gt'; window: string;
}
export interface PhaseMetrics {
  phase_latency_ms: number; phase_error_budget: number; phase_fix_rate: number;
}
export interface PhaseSloReport {
  phase: string; metrics: PhaseMetrics; statuses: Record<PhaseSliName, SloStatus>; sampleCount: number;
}
export interface DailySloReport {
  timestamp: string; date: string; phases: PhaseSloReport[]; overallStatus: 'passing' | 'at_risk' | 'failing';
}
export interface SloReporterOptions {
  latencyTargetMs?: number; errorBudgetTarget?: number; fixRateTarget?: number;
}
const D: Required<SloReporterOptions> = { latencyTargetMs: 30000, errorBudgetTarget: 0.1, fixRateTarget: 0.9 };
export const PHASE_SLI_DEFINITIONS: PhaseSliDefinition[] = [
  { name: 'phase_latency_ms', description: 'Avg phase latency', target: D.latencyTargetMs, operator: 'lt', window: '24h' },
  { name: 'phase_error_budget', description: 'Failed ratio', target: D.errorBudgetTarget, operator: 'lt', window: '24h' },
  { name: 'phase_fix_rate', description: 'Fix success ratio', target: D.fixRateTarget, operator: 'gt', window: '24h' },
];
interface PS { phase: string; latencyMs: number; success: boolean; producedFix: boolean; timestamp: number; }
export class SloReporter {
  private s: PS[] = []; private o: Required<SloReporterOptions>;
  constructor(opts?: SloReporterOptions) { this.o = { ...D, ...opts }; }
  recordPhase(phase: string, latencyMs: number, success: boolean, producedFix: boolean): void {
    this.s.push({ phase, latencyMs, success, producedFix, timestamp: Date.now() });
  }
  recordFailure(phase: string, latencyMs: number): void { this.recordPhase(phase, latencyMs, false, false); }
  recordFix(phase: string, latencyMs: number): void { this.recordPhase(phase, latencyMs, true, true); }
  evictOldSamples(rt: number = 604800000): void { const c = Date.now() - rt; while (this.s.length > 0 && this.s[0].timestamp < c) this.s.shift(); }
  generateDailyReport(): DailySloReport {
    this.evictOldSamples();
    const ws = this.s.filter((x) => x.timestamp >= Date.now() - 86400000);
    const pm = new Map<string, PS[]>();
    for (const x of ws) { (pm.get(x.phase) ?? (pm.set(x.phase, []), pm.get(x.phase))).push(x); }
    const ph: PhaseSloReport[] = []; let ab = false, aw = false;
    for (const [pn, ps] of pm) {
      const m = this.cm(ps), hf = ps.some((x) => x.producedFix), st = this.es(m, hf);
      ph.push({ phase: pn, metrics: m, statuses: st, sampleCount: ps.length });
      for (const [n, s] of Object.entries(st)) { if (n === 'phase_fix_rate' && !hf) continue; if (s === 'breached') ab = true; else if (s === 'warning') aw = true; }
      this.rm(pn, m, st, hf);
    }
    const os: DailySloReport['overallStatus'] = ab ? 'failing' : aw ? 'at_risk' : 'passing';
    const n = new Date();
    return { timestamp: n.toISOString(), date: n.toISOString().slice(0, 10), phases: ph, overallStatus: os };
  }
  reset(): void { this.s.length = 0; }
  private cm(x: PS[]): PhaseMetrics {
    if (x.length === 0) return { phase_latency_ms: 0, phase_error_budget: 0, phase_fix_rate: 0 };
    return { phase_latency_ms: Math.round(x.reduce((a, b) => a + b.latencyMs, 0) / x.length), phase_error_budget: x.filter((s) => !s.success).length / x.length, phase_fix_rate: x.filter((s) => s.producedFix).length / x.length };
  }
  private es(m: PhaseMetrics, hf: boolean): Record<PhaseSliName, SloStatus> {
    return { phase_latency_ms: this.ev(m.phase_latency_ms, this.o.latencyTargetMs, 'lt'), phase_error_budget: this.ev(m.phase_error_budget, this.o.errorBudgetTarget, 'lt'), phase_fix_rate: hf ? this.ev(m.phase_fix_rate, this.o.fixRateTarget, 'gt') : 'compliant' };
  }
  private ev(v: number, t: number, op: 'lt' | 'gt'): SloStatus {
    if (op === 'lt') { if (v < t) return 'compliant'; if (v < t * 1.2) return 'warning'; return 'breached'; }
    if (v >= t) return 'compliant'; if (v >= t * 0.8) return 'warning'; return 'breached';
  }
  private rm(phase: string, m: PhaseMetrics, st: Record<PhaseSliName, SloStatus>, hf: boolean): void {
    const l = { phase };
    bridgeMetrics.setGauge('slo_phase_latency_ms', l, m.phase_latency_ms);
    bridgeMetrics.setGauge('slo_phase_error_budget', l, m.phase_error_budget);
    bridgeMetrics.setGauge('slo_phase_fix_rate', l, m.phase_fix_rate);
    for (const [sn, s] of Object.entries(st)) { if (sn === 'phase_fix_rate' && !hf) continue; bridgeMetrics.setGauge('slo_' + sn + '_status', l, s === 'compliant' ? 0 : s === 'warning' ? 1 : 2); }
  }
}
let _i: SloReporter | null = null;
export function getSloReporter(opts?: SloReporterOptions): SloReporter { if (!_i) _i = new SloReporter(opts); return _i; }
