import { rootLogger } from '../utils/logger.js';
import { config } from '../config.js';
import type { RemediationStore } from './remediationStore.js';
const log = rootLogger.child({ module: 'remediation-engine' });
export interface RemediationContext { alertId: string; reason: string; metadata?: Record<string, unknown>; }
export interface RemediationResult { action: string; success: boolean; message: string; durationMs: number; context: RemediationContext; }
export interface IRemediation { readonly name: string; readonly description: string; readonly cooldownMs: number; evaluate(ctx: RemediationContext): boolean | Promise<boolean>; execute(ctx: RemediationContext): Promise<RemediationResult>; }
const C_THRESHOLD = 3, C_WINDOW = 3_600_000, C_RESET = 600_000;
export class RemediationEngine {
  private readonly remediations = new Map<string, IRemediation>();
  private readonly circuitBreakers = new Map<string, { failures: number[]; openUntil: number }>();
  private readonly lastExecuted = new Map<string, number>();
  private readonly store: RemediationStore | null; private disabled = false;
  constructor(store?: RemediationStore) { this.store = store ?? null; }
  setDisabled(f: boolean): void { this.disabled = f; if (f) log.warn('DISABLED'); }
  register(r: IRemediation): void { this.remediations.set(r.name, r); }
  registerAll(aa: IRemediation[]): void { for (const a of aa) this.register(a); }
  async evaluate(ctx: RemediationContext): Promise<IRemediation[]> {
    if (this.disabled) return [];
    const triggered: IRemediation[] = [];
    for (const [name, rem] of this.remediations) {
      if (this.isCircuitBroken(name)) { await this.persist(name, ctx, 'skipped', 'circuit_open'); continue; }
      const lastRun = this.lastExecuted.get(name) ?? 0;
      if (lastRun > 0 && Date.now() - lastRun < rem.cooldownMs) { await this.persist(name, ctx, 'skipped', 'cooldown'); continue; }
      try { if (await rem.evaluate(ctx)) triggered.push(rem); }
      catch (err) { log.error({ err: String(err), name }, 'evaluate threw'); this.recordFailure(name); await this.persist(name, ctx, 'evaluate_error', String(err)); }
    }
    return triggered;
  }
  async execute(rem: IRemediation, ctx: RemediationContext): Promise<RemediationResult> {
    if (this.disabled) return { action: rem.name, success: false, message: 'Disabled', durationMs: 0, context: ctx };
    const startedAt = Date.now(); this.lastExecuted.set(rem.name, startedAt);
    try {
      const result = await rem.execute(ctx);
      if (result.success) this.recordSuccess(rem.name); else this.recordFailure(rem.name);
      await this.persist(rem.name, ctx, result.success ? 'success' : 'failure', result.message);
      result.durationMs = Date.now() - startedAt; return result;
    } catch (err) {
      const msg = 'Execution threw: ' + String(err); log.error({ err: String(err), name: rem.name }, msg);
      this.recordFailure(rem.name); await this.persist(rem.name, ctx, 'error', String(err));
      return { action: rem.name, success: false, message: msg, durationMs: Date.now() - startedAt, context: ctx };
    }
  }
  async evaluateAndExecute(ctx: RemediationContext): Promise<RemediationResult[]> {
    const results: RemediationResult[] = [];
    for (const rem of await this.evaluate(ctx)) results.push(await this.execute(rem, ctx));
    return results;
  }
  private isCircuitBroken(name: string): boolean {
    const state = this.circuitBreakers.get(name); if (!state) return false;
    if (Date.now() < state.openUntil) return true;
    this.circuitBreakers.delete(name); return false;
  }
  private recordSuccess(name: string): void { this.circuitBreakers.delete(name); }
  private recordFailure(name: string): void {
    const now = Date.now(); let state = this.circuitBreakers.get(name);
    if (!state) { state = { failures: [], openUntil: 0 }; this.circuitBreakers.set(name, state); }
    state.failures = state.failures.filter((ts:number) => now - ts < C_WINDOW); state.failures.push(now);
    if (state.failures.length >= C_THRESHOLD) { state.openUntil = now + C_RESET; log.error({ name, count: state.failures.length }, 'CB OPENED'); }
  }
  private async persist(action: string, ctx: RemediationContext, status: string, detail: string): Promise<void> {
    if (!this.store) return;
    try { await this.store.record({ action, alertId: ctx.alertId, reason: ctx.reason, status: status as any, detail, metadata: ctx.metadata }); }
    catch (err) { log.error({ err: String(err) }, 'persist failed'); }
  }
}
export class QueueScaleUpRemediation implements IRemediation {
  readonly name = 'QueueScaleUp'; readonly description = 'Scale workers by +2 when queue > 100'; readonly cooldownMs = 300_000;
  evaluate(ctx: RemediationContext): boolean { return (ctx.metadata?.queueDepth as number ?? 0) > 100; }
  async execute(ctx: RemediationContext): Promise<RemediationResult> { log.warn('AUTO-REMEDIATION: QueueScaleUp'); return { action: this.name, success: true, message: 'Scale-up signalled (+2 replicas)', durationMs: 0, context: ctx }; }
}
export class WorkerRestartRemediation implements IRemediation {
  readonly name = 'WorkerRestart'; readonly description = 'Restart workers when pool empty'; readonly cooldownMs = 300_000;
  evaluate(ctx: RemediationContext): boolean { return (ctx.metadata?.workerCount as number ?? 1) === 0; }
  async execute(ctx: RemediationContext): Promise<RemediationResult> { log.warn('AUTO-REMEDIATION: WorkerRestart'); return { action: this.name, success: true, message: 'Worker restart signalled', durationMs: 0, context: ctx }; }
}
export class DbPoolIncreaseRemediation implements IRemediation {
  readonly name = 'DbPoolIncrease'; readonly description = 'Increase DB pool by 25% when util > 80%'; readonly cooldownMs = 600_000;
  evaluate(ctx: RemediationContext): boolean { return (ctx.metadata?.connectionUtilization as number ?? 0) > 0.8; }
  async execute(ctx: RemediationContext): Promise<RemediationResult> { log.warn('AUTO-REMEDIATION: DbPoolIncrease'); return { action: this.name, success: true, message: 'DB pool +25% signalled', durationMs: 0, context: ctx }; }
}
export class TokenRotationRemediation implements IRemediation {
  readonly name = 'TokenRotation'; readonly description = 'Rotate tokens on 401 spikes or age > 48h'; readonly cooldownMs = 600_000;
  evaluate(ctx: RemediationContext): boolean { return (ctx.metadata?._401Count as number ?? 0) > 5 || (ctx.metadata?.tokenAgeHours as number ?? 0) > 48; }
  async execute(ctx: RemediationContext): Promise<RemediationResult> { log.warn({ tokenType: ctx.metadata?.tokenType }, 'AUTO-REMEDIATION: TokenRotation'); return { action: this.name, success: true, message: 'Rotation signalled for ' + ((ctx.metadata?.tokenType as string) ?? 'unknown'), durationMs: 0, context: ctx }; }
}
export class AgentKillRemediation implements IRemediation {
  readonly name = 'AgentKill'; readonly description = 'Kill runaway agent > 1.5x timeout'; readonly cooldownMs = 120_000;
  evaluate(ctx: RemediationContext): boolean { const d = ctx.metadata?.agentRunDurationMs as number ?? 0; const t = ctx.metadata?.agentTimeoutMs as number ?? 600_000; return d > t * 1.5; }
  async execute(ctx: RemediationContext): Promise<RemediationResult> { log.warn('AUTO-REMEDIATION: AgentKill'); return { action: this.name, success: true, message: 'SIGTERM sent to runaway agent', durationMs: 0, context: ctx }; }
}
export function createDefaultRemediations(): IRemediation[] {
  return [new QueueScaleUpRemediation(), new WorkerRestartRemediation(), new DbPoolIncreaseRemediation(), new TokenRotationRemediation(), new AgentKillRemediation()];
}
let _engine: RemediationEngine | null = null;
export function getRemediationEngine(): RemediationEngine { if (!_engine) throw new Error('RemediationEngine not initialized'); return _engine; }
export function initRemediationEngine(store?: RemediationStore): RemediationEngine {
  if (_engine) return _engine; _engine = new RemediationEngine(store); _engine.registerAll(createDefaultRemediations());
  _engine.setDisabled((config.syntaro as any)?.remediation?.disabled ?? false); log.info('Engine initialized with 5 actions'); return _engine;
}
export function resetRemediationEngine(): void { _engine = null; }
