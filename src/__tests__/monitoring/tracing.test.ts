/**
 * Unit tests for src/monitoring/tracing.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Tracer } from '@opentelemetry/api';
vi.mock('@opentelemetry/api', () => {
  const ms = { end: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), setAttribute: vi.fn(), setAttributes: vi.fn(), addEvent: vi.fn(), isRecording: () => true, spanContext: () => ({ traceId: 't', spanId: 's' }) };
  return { trace: { getTracer: vi.fn(() => ({ startSpan: vi.fn(() => ms) })), setSpan: vi.fn((ctx: unknown) => ctx ?? {}) }, context: { active: vi.fn(() => ({})) }, SpanStatusCode: { OK: 0, ERROR: 1, UNSET: 2 } };
});
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));
describe('tracing', () => {
  let m: typeof import('../../monitoring/tracing.js');
  beforeEach(async () => { vi.clearAllMocks(); m = await import('../../monitoring/tracing.js'); });
  it('getPipelineTracer', () => { expect(m.getPipelineTracer()).toBeDefined(); });
  it('setPipelineTracer', () => { const t = { startSpan: vi.fn(() => ({ end: vi.fn() })) } as unknown as Tracer; m.setPipelineTracer(t); expect(m.getPipelineTracer()).toBe(t); });
  it('startPhaseSpan', () => { expect(m.startPhaseSpan({ phase: 'run_fix', sessionId: 's1' })).toBeDefined(); });
  it('startPhaseSpan w/ parent', () => { const p = m.startPhaseSpan({ phase: 'webhook_receive', sessionId: 's1' }); expect(m.startPhaseSpan({ phase: 'enqueue', sessionId: 's1' }, p)).toBeDefined(); });
  it('tracePhase ok', async () => { expect(await m.tracePhase({ phase: 'run_fix', sessionId: 's1' }, async () => 'done')).toBe('done'); });
  it('tracePhase fail', async () => { await expect(m.tracePhase({ phase: 'run_fix', sessionId: 's1' }, async () => { throw new Error('fail'); })).rejects.toThrow('fail'); });
  it('startStepSpan', () => { expect(m.startStepSpan(m.startPhaseSpan({ phase: 'run_fix', sessionId: 's1' }), 'triage')).toBeDefined(); });
  it('traceStep', async () => { expect(await m.traceStep(m.startPhaseSpan({ phase: 'run_fix', sessionId: 's1' }), 'triage', async () => 'ok')).toBe('ok'); });
  it('PHASE_SPAN_NAMES', () => { expect(m.PHASE_SPAN_NAMES).toEqual(['webhook_receive', 'enqueue', 'run_fix', 'create_pr']); });
});
