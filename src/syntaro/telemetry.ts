import { EventEmitter } from 'node:events';
import { bridgeMetrics } from '../bridge/metrics.js';

export interface SyntaroDispatchPayload {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  installationId: number;
  source: string;
  templateName: string;
}

export interface SyntaroDispatchErrorPayload {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  installationId: number;
  error: string;
  source: string;
}

export interface SyntaroTelemetryEvents {
  'symphony.syntaro.dispatch': (payload: SyntaroDispatchPayload) => void;
  'symphony.syntaro.dispatch_error': (payload: SyntaroDispatchErrorPayload) => void;
}

class SyntaroTelemetryEmitter extends EventEmitter {
  emit<K extends keyof SyntaroTelemetryEvents>(event: K, ...args: Parameters<SyntaroTelemetryEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof SyntaroTelemetryEvents>(event: K, listener: SyntaroTelemetryEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<K extends keyof SyntaroTelemetryEvents>(event: K, listener: SyntaroTelemetryEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof SyntaroTelemetryEvents>(event: K, listener: SyntaroTelemetryEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export const syntaroTelemetry = new SyntaroTelemetryEmitter();

export function recordSyntaroDispatch(payload: SyntaroDispatchPayload): void {
  syntaroTelemetry.emit('symphony.syntaro.dispatch', payload);
  bridgeMetrics.incrementCounter('syntaro_dispatches_total', {
    source: payload.source,
    status: 'success',
  });
  bridgeMetrics.incrementCounter('syntaro_dispatches_by_repo_total', {
    repo: `${payload.repoOwner}/${payload.repoName}`,
  });
}

export function recordSyntaroDispatchError(payload: SyntaroDispatchErrorPayload): void {
  syntaroTelemetry.emit('symphony.syntaro.dispatch_error', payload);
  bridgeMetrics.incrementCounter('syntaro_dispatches_total', {
    source: payload.source,
    status: 'error',
  });
  bridgeMetrics.incrementCounter('syntaro_dispatch_errors_total', {
    source: payload.source,
    error: payload.error,
  });
}
