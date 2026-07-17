/**
 * Structured JSON Logger — pipeline-aware logging with correlation context.
 */
import type { Logger } from 'pino';
import { rootLogger } from '../utils/logger.js';
export interface CorrelationContext { requestId: string; correlationId: string; installationId?: number; repo?: string; issueNumber?: number; }
export interface StructuredLogger {
  debug(obj: Record<string, unknown> | string, msg?: string): void;
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
  fatal(obj: Record<string, unknown> | string, msg?: string): void;
  child(bindings: Record<string, unknown>): StructuredLogger;
  readonly pino: Logger;
}
function ne(err: unknown): { type: string; message: string; stack?: string } {
  if (err instanceof Error) return { type: err.name || 'Error', message: err.message, stack: err.stack };
  if (typeof err === 'string') return { type: 'StringError', message: err }; return { type: 'UnknownError', message: String(err) };
}
export function createPipelineLogger(ctx: CorrelationContext): StructuredLogger {
  const bf: Record<string, unknown> = { requestId: ctx.requestId, correlationId: ctx.correlationId };
  if (ctx.installationId !== undefined) bf.installationId = ctx.installationId;
  if (ctx.repo !== undefined) bf.repo = ctx.repo; if (ctx.issueNumber !== undefined) bf.issueNumber = ctx.issueNumber;
  return bs(rootLogger.child(bf));
}
export function createRequestLogger(requestId: string): StructuredLogger { return createPipelineLogger({ requestId, correlationId: requestId }); }
function bs(p: Logger): StructuredLogger {
  return {
    get pino(): Logger { return p; },
    debug(o: any, m?: string) { if (typeof o === 'string') p.debug({}, o); else p.debug(nf(o), m ?? ''); },
    info(o: any, m?: string) { if (typeof o === 'string') p.info({}, o); else p.info(nf(o), m ?? ''); },
    warn(o: any, m?: string) { if (typeof o === 'string') p.warn({}, o); else p.warn(nf(o), m ?? ''); },
    error(o: any, m?: string) { if (typeof o === 'string') p.error({}, o); else p.error(nf(o), m ?? ''); },
    fatal(o: any, m?: string) { if (typeof o === 'string') p.fatal({}, o); else p.fatal(nf(o), m ?? ''); },
    child(b: Record<string, unknown>) { return bs(p.child(b)); },
  };
}
function nf(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) { if (k === 'err' && v !== undefined) out.error = ne(v); else if (k === 'error' && v instanceof Error) out.error = ne(v); else out[k] = v; }
  return out;
}
