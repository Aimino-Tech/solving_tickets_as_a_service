import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSession, getSession, advanceSession,
  failSession, cancelSession, retrySession,
  listSessions, getSessionEvents, sessionStore,
} from '../../pipeline/sessionOrchestrator.js';

describe('sessionOrchestrator', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('creates a session', () => {
    const session = createSession('issue-1', 'stas:fix');
    expect(session.sessionId).toBeDefined();
    expect(session.issueId).toBe('issue-1');
    expect(session.pipelineName).toBe('stas:fix');
    expect(session.status).toBe('queued');
  });

  it('retrieves a session by ID', () => {
    const session = createSession('issue-1', 'stas:fix');
    const retrieved = getSession(session.sessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.sessionId).toBe(session.sessionId);
  });

  it('advances a session through stages', () => {
    const session = createSession('issue-1', 'stas:fix');
    const triage = advanceSession(session.sessionId, 'triage');
    expect(triage!.currentStage).toBe('triage');
    expect(triage!.status).toBe('running');

    const workspace = advanceSession(session.sessionId, 'workspace');
    expect(workspace!.currentStage).toBe('workspace');

    const agent = advanceSession(session.sessionId, 'agent');
    expect(agent!.currentStage).toBe('agent');
  });

  it('fails a session', () => {
    const session = createSession('issue-1', 'stas:fix');
    const failed = failSession(session.sessionId, 'Test error');
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBe('Test error');
  });

  it('cancels a session', () => {
    const session = createSession('issue-1', 'stas:fix');
    const cancelled = cancelSession(session.sessionId);
    expect(cancelled!.status).toBe('cancelled');
  });

  it('retries a failed session', () => {
    const session = createSession('issue-1', 'stas:fix', 3);
    advanceSession(session.sessionId, 'agent');
    failSession(session.sessionId, 'error');
    const retried = retrySession(session.sessionId);
    expect(retried).not.toBeNull();
    expect(retried!.attempt).toBe(2);
  });

  it('lists sessions with filters', () => {
    createSession('issue-1', 'stas:fix');
    createSession('issue-2', 'stas:feature');
    expect(listSessions().length).toBe(2);
    expect(listSessions({ issueId: 'issue-1' }).length).toBe(1);
  });

  it('records session events', () => {
    const session = createSession('issue-1', 'stas:fix');
    advanceSession(session.sessionId, 'triage');
    const events = getSessionEvents(session.sessionId);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe('stage.advanced');
  });

  it('returns undefined for non-existent session', () => {
    const session = getSession('nonexistent');
    expect(session).toBeUndefined();
  });
});
