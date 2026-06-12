export interface EvalRunMetadata {
  runId: string;
  branch: string;
  commit: string;
  testCount: number;
  ciRunId?: string;
  ciRunUrl?: string;
  suite: 'smoke' | 'standard' | 'full';
}

export interface SpanEvent {
  name: string;
  startTime: number;
  endTime?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration?: number;
}

export function createTraceSession(runId: string, metadata: EvalRunMetadata) {
  const baseUrl = process.env.LANGFUSE_HOST ?? 'https://us.cloud.langfuse.com';

  const traceId = `eval-${runId}-${Date.now()}`;
  const spans: SpanEvent[] = [];

  function startSpan(name: string, input?: Record<string, unknown>): void {
    spans.push({ name, startTime: Date.now(), input });
  }

  function endSpan(name: string, output?: Record<string, unknown>): void {
    const span = spans.find((s) => s.name === name && !s.endTime);
    if (span) {
      span.endTime = Date.now();
      span.duration = span.endTime - span.startTime;
      span.output = output;
    }
  }

  function getTraceUrl(): string {
    return `${baseUrl}/trace/${traceId}`;
  }

  function toJson(): Record<string, unknown> {
    return {
      traceId,
      metadata,
      spans: spans.map((s) => ({
        ...s,
        durationMs: s.duration ?? (s.endTime ? s.endTime - s.startTime : undefined),
      })),
      traceUrl: getTraceUrl(),
      createdAt: new Date().toISOString(),
    };
  }

  return {
    traceId,
    startSpan,
    endSpan,
    getTraceUrl,
    toJson,
    metadata,
  };
}

export type TraceSession = ReturnType<typeof createTraceSession>;

export function formatTraceUrl(baseUrl: string, traceId: string): string {
  const host = baseUrl.replace(/\/$/, '');
  return `${host}/trace/${traceId}`;
}

export function generateCiOutput(traceUrl: string): string {
  return `🔗 LangFuse Trace: ${traceUrl}`;
}

export function appendTraceToEvalResult(
  evalResult: Record<string, unknown>,
  traceUrl: string,
  traceId: string,
): Record<string, unknown> {
  return {
    ...evalResult,
    langfuseTraceUrl: traceUrl,
    langfuseTraceId: traceId,
  };
}
