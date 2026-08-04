import { describe, expect, it } from 'vitest';
import {
  isValidTransition, getNextStage, getStageIndex,
  calculateProgress, createSessionState, transitionState,
  failState, cancelState, retryState,
} from '../../pipeline/stateMachine.js';

describe('stateMachine', () => {
  it('validates transitions correctly', () => {
    expect(isValidTransition('queued', 'triage')).toBe(true);
    expect(isValidTransition('triage', 'workspace')).toBe(true);
    expect(isValidTransition('agent', 'verification')).toBe(true);
    expect(isValidTransition('completed', 'failed')).toBe(false);
    expect(isValidTransition('queued', 'agent')).toBe(false);
  });

  it('gets next stage', () => {
    expect(getNextStage('queued')).toBe('triage');
    expect(getNextStage('cleanup')).toBe('completed');
    expect(getNextStage('completed')).toBeNull();
  });

  it('gets stage index', () => {
    expect(getStageIndex('queued')).toBe(0);
    expect(getStageIndex('triage')).toBe(1);
    expect(getStageIndex('completed')).toBe(10);
  });

  it('calculates progress', () => {
    expect(calculateProgress('queued', 'running')).toBe(0);
    expect(calculateProgress('completed', 'completed')).toBe(1);
    expect(calculateProgress('agent', 'running')).toBe(3 / 11);
  });

  it('creates session state', () => {
    const state = createSessionState('sess-1', 'issue-1', 'syntaro:fix');
    expect(state.sessionId).toBe('sess-1');
    expect(state.status).toBe('queued');
    expect(state.currentStage).toBe('queued');
    expect(state.attempt).toBe(1);
  });

  it('transitions state', () => {
    const state = createSessionState('sess-1', 'issue-1', 'syntaro:fix');
    const advanced = transitionState(state, 'triage');
    expect(advanced.currentStage).toBe('triage');
    expect(advanced.status).toBe('running');
  });

  it('fails state', () => {
    const state = createSessionState('sess-1', 'issue-1', 'syntaro:fix');
    const failed = failState(state, 'Something went wrong');
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Something went wrong');
  });

  it('cancels state', () => {
    const state = createSessionState('sess-1', 'issue-1', 'syntaro:fix');
    const cancelled = cancelState(state);
    expect(cancelled.status).toBe('cancelled');
  });

  it('retries state', () => {
    const state = createSessionState('sess-1', 'issue-1', 'syntaro:fix', 3);
    const advanced = transitionState(state, 'agent');
    const failed = failState(advanced, 'error');
    const retried = retryState(failed);
    expect(retried).not.toBeNull();
    expect(retried!.attempt).toBe(2);
    expect(retried!.status).toBe('running');
  });

  it('returns null when max retries exceeded', () => {
    const state = { ...createSessionState('sess-1', 'issue-1', 'syntaro:fix', 1), attempt: 1 };
    const result = retryState(state);
    expect(result).toBeNull();
  });
});
