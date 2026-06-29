import { randomUUID } from 'node:crypto';
import { rootLogger } from '../utils/logger.js';
import type { SessionState, SessionEvent } from './types.js';
import { createSessionState, transitionState, failState, cancelState, retryState } from './stateMachine.js';

const log = rootLogger.child({ module: 'session-orchestrator' });

interface SessionStore {
  get(id: string): SessionState | undefined;
  set(id: string, state: SessionState): void;
  delete(id: string): boolean;
  list(filter?: { status?: string; issueId?: string }): SessionState[];
  clear(): void;
}

class InMemorySessionStore implements SessionStore {
  private sessions: Map<string, SessionState> = new Map();
  private events: Map<string, SessionEvent[]> = new Map();
  private readonly maxSessions = 1000;

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  set(id: string, state: SessionState): void {
    this.sessions.set(id, state);
    if (this.sessions.size > this.maxSessions) {
      const oldest = [...this.sessions.entries()]
        .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
        .slice(0, this.sessions.size - this.maxSessions);
      for (const [key] of oldest) {
        this.sessions.delete(key);
        this.events.delete(key);
      }
    }
  }

  delete(id: string): boolean {
    this.events.delete(id);
    return this.sessions.delete(id);
  }

  list(filter?: { status?: string; issueId?: string }): SessionState[] {
    let result = [...this.sessions.values()];
    if (filter?.status) {
      result = result.filter((s) => s.status === filter.status);
    }
    if (filter?.issueId) {
      result = result.filter((s) => s.issueId === filter.issueId);
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  clear(): void {
    this.sessions.clear();
    this.events.clear();
  }

  getEvents(sessionId: string, limit: number = 50): SessionEvent[] {
    return (this.events.get(sessionId) ?? []).slice(-limit);
  }

  addEvent(sessionId: string, event: SessionEvent): void {
    const existing = this.events.get(sessionId) ?? [];
    existing.push(event);
    if (existing.length > 200) {
      existing.splice(0, existing.length - 200);
    }
    this.events.set(sessionId, existing);
  }
}

export const sessionStore = new InMemorySessionStore();

export function createSession(issueId: string, pipelineName: string, maxAttempts?: number): SessionState {
  const sessionId = randomUUID();
  const state = createSessionState(sessionId, issueId, pipelineName, maxAttempts);
  sessionStore.set(sessionId, state);
  log.info({ sessionId, issueId, pipelineName }, 'Session created');
  return state;
}

export function getSession(sessionId: string): SessionState | undefined {
  return sessionStore.get(sessionId);
}

export function advanceSession(sessionId: string, toStage: import('./types.js').PipelineStage): SessionState | undefined {
  const state = sessionStore.get(sessionId);
  if (!state) {
    log.warn({ sessionId }, 'Session not found for advance');
    return undefined;
  }
  const updated = transitionState(state, toStage);
  sessionStore.set(sessionId, updated);

  const event: SessionEvent = {
    event: 'stage.advanced',
    timestamp: Date.now(),
    sessionId,
    stage: toStage,
    data: { from: state.currentStage },
  };
  sessionStore.addEvent(sessionId, event);

  return updated;
}

export function failSession(sessionId: string, error: string): SessionState | undefined {
  const state = sessionStore.get(sessionId);
  if (!state) {
    log.warn({ sessionId }, 'Session not found for fail');
    return undefined;
  }
  const updated = failState(state, error);
  sessionStore.set(sessionId, updated);

  const event: SessionEvent = {
    event: 'stage.failed',
    timestamp: Date.now(),
    sessionId,
    stage: state.currentStage,
    data: { error },
  };
  sessionStore.addEvent(sessionId, event);

  return updated;
}

export function cancelSession(sessionId: string): SessionState | undefined {
  const state = sessionStore.get(sessionId);
  if (!state) {
    log.warn({ sessionId }, 'Session not found for cancel');
    return undefined;
  }
  const updated = cancelState(state);
  sessionStore.set(sessionId, updated);

  const event: SessionEvent = {
    event: 'session.cancelled',
    timestamp: Date.now(),
    sessionId,
    stage: state.currentStage,
  };
  sessionStore.addEvent(sessionId, event);

  return updated;
}

export function retrySession(sessionId: string): SessionState | null {
  const state = sessionStore.get(sessionId);
  if (!state) {
    log.warn({ sessionId }, 'Session not found for retry');
    return null;
  }
  const updated = retryState(state);
  if (!updated) return null;
  sessionStore.set(sessionId, updated);

  const event: SessionEvent = {
    event: 'session.retrying',
    timestamp: Date.now(),
    sessionId,
    stage: 'queued',
    data: { attempt: updated.attempt },
  };
  sessionStore.addEvent(sessionId, event);

  return updated;
}

export function listSessions(filter?: { status?: string; issueId?: string }): SessionState[] {
  return sessionStore.list(filter);
}

export function getSessionEvents(sessionId: string, limit?: number): SessionEvent[] {
  return sessionStore.getEvents(sessionId, limit);
}
