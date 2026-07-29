/**
 * Distributed Tracing — OpenTelemetry span wrappers for pipeline phases.
 */
import type { Attributes as OA, Span as OS, Tracer as OT } from '@opentelemetry/api';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { rootLogger } from '../utils/logger.js';
export type Span = OS; export type Tracer = OT; export type Attributes = OA;
export const PHASE_SPAN_NAMES = ['webhook_receive', 'enqueue', 'run_fix', 'create_pr'] as const;
export type PhaseSpanName = (typeof PHASE_SPAN_NAMES)[number];
const log = rootLogger.child({ module: 'tracing' });
let _t: Tracer | null = null;
export function getPipelineTracer(): Tracer { if (!_t) _t = trace.getTracer('pipeline-instrumentation', '0.1.0'); return _t; }
export function setPipelineTracer(t: Tracer): void { _t = t; }
export interface PhaseAttributes { phase: PhaseSpanName; sessionId: string; issue?: string; attempt?: number; installationId?: number; }
function bpa(a: PhaseAttributes): Attributes {
  const r: Attributes = { 'pipeline.phase': a.phase, 'pipeline.session_id': a.sessionId };
  if (a.issue !== undefined) r['pipeline.issue'] = a.issue; if (a.attempt !== undefined) r['pipeline.attempt'] = a.attempt; if (a.installationId !== undefined) r['pipeline.installation_id'] = a.installationId; return r;
}
export function startPhaseSpan(a: PhaseAttributes, parent?: Span): Span {
  const s = getPipelineTracer().startSpan('pipeline.' + a.phase, { attributes: bpa(a) }, parent ? trace.setSpan(context.active(), parent) : context.active());
  log.debug({ phase: a.phase, sessionId: a.sessionId }, 'Phase span started'); return s;
}
export async function tracePhase<T>(a: PhaseAttributes, fn: (s: Span) => Promise<T>, parent?: Span): Promise<T> {
  const s = startPhaseSpan(a, parent); try { const r = await fn(s); s.setStatus({ code: SpanStatusCode.OK }); return r; }
  catch (err) { const m = err instanceof Error ? err.message : String(err); s.setStatus({ code: SpanStatusCode.ERROR, message: m }); s.recordException(err instanceof Error ? err : new Error(String(err))); throw err; } finally { s.end(); }
}
export function startStepSpan(parent: Span, name: string, attrs?: Attributes): Span {
  return getPipelineTracer().startSpan('step.' + name, { attributes: { 'step.name': name, ...attrs } }, trace.setSpan(context.active(), parent));
}
export async function traceStep<T>(parent: Span, name: string, fn: (s: Span) => Promise<T>, attrs?: Attributes): Promise<T> {
  const s = startStepSpan(parent, name, attrs); try { const r = await fn(s); s.setStatus({ code: SpanStatusCode.OK }); return r; }
  catch (err) { const m = err instanceof Error ? err.message : String(err); s.setStatus({ code: SpanStatusCode.ERROR, message: m }); s.recordException(err instanceof Error ? err : new Error(String(err))); throw err; } finally { s.end(); }
}
