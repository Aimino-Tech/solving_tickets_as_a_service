import { EventEmitter } from 'node:events';
import { bridgeMetrics } from '../bridge/metrics.js';

export interface StasDispatchPayload {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  installationId: number;
  source: string;
  templateName: string;
}

export interface StasDispatchErrorPayload {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  installationId: number;
  error: string;
  source: string;
}

export interface StasTelemetryEvents {
  'symphony.stas.dispatch': (payload: StasDispatchPayload) => void;
  'symphony.stas.dispatch_error': (payload: StasDispatchErrorPayload) => void;
}

class StasTelemetryEmitter extends EventEmitter {
  emit<K extends keyof StasTelemetryEvents>(event: K, ...args: Parameters<StasTelemetryEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof StasTelemetryEvents>(event: K, listener: StasTelemetryEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<K extends keyof StasTelemetryEvents>(event: K, listener: StasTelemetryEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof StasTelemetryEvents>(event: K, listener: StasTelemetryEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export const stasTelemetry = new StasTelemetryEmitter();

export function recordStasDispatch(payload: StasDispatchPayload): void {
  stasTelemetry.emit('symphony.stas.dispatch', payload);
  bridgeMetrics.incrementCounter('stas_dispatches_total', {
    source: payload.source,
    status: 'success',
  });
  bridgeMetrics.incrementCounter('stas_dispatches_by_repo_total', {
    repo: `${payload.repoOwner}/${payload.repoName}`,
  });
}

export function recordStasDispatchError(payload: StasDispatchErrorPayload): void {
  stasTelemetry.emit('symphony.stas.dispatch_error', payload);
  bridgeMetrics.incrementCounter('stas_dispatches_total', {
    source: payload.source,
    status: 'error',
  });
  bridgeMetrics.incrementCounter('stas_dispatch_errors_total', {
    source: payload.source,
    error: payload.error,
  });
}
