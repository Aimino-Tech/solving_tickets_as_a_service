import { rootLogger } from '../utils/logger.js';
import type { PipelinePhase, PipelineStage, PipelineStatus, SessionState } from './types.js';

const log = rootLogger.child({ module: 'pipeline-state-machine' });

const VALID_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  queued: ['triage', 'phase_pre'],
  triage: ['workspace', 'failed'],
  workspace: ['agent', 'failed'],
  agent: ['verification', 'failed'],
  verification: ['self_audit', 'failed'],
  self_audit: ['anti_mockup', 'failed'],
  anti_mockup: ['pr_creation', 'failed'],
  pr_creation: ['review', 'failed'],
  review: ['cleanup', 'failed'],
  cleanup: ['completed', 'failed'],
  phase_pre: ['phase_main', 'failed'],
  phase_main: ['phase_post', 'failed'],
  phase_post: ['phase_final', 'failed'],
  phase_final: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

const STAGE_ORDER: PipelineStage[] = [
  'queued',
  'triage',
  'workspace',
  'agent',
  'verification',
  'self_audit',
  'anti_mockup',
  'pr_creation',
  'review',
  'cleanup',
  'completed',
];

/** Maps PipelinePhase names to their corresponding PipelineStage values. */
const PHASE_STAGE_MAP: Record<PipelinePhase, PipelineStage> = {
  pre: 'phase_pre',
  main: 'phase_main',
  post: 'phase_post',
  final: 'phase_final',
};

export function isValidTransition(from: PipelineStage, to: PipelineStage): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getNextStage(current: PipelineStage): PipelineStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export function getStageIndex(stage: PipelineStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function calculateProgress(currentStage: PipelineStage, status: PipelineStatus): number {
  if (status === 'completed') return 1.0;
  if (status === 'failed' || status === 'cancelled') {
    const idx = getStageIndex(currentStage);
    return Math.max(0, idx / STAGE_ORDER.length);
  }
  const idx = getStageIndex(currentStage);
  return Math.max(0, idx / STAGE_ORDER.length);
}

export function createSessionState(
  sessionId: string,
  issueId: string,
  pipelineName: string,
  maxAttempts: number = 3,
): SessionState {
  return {
    sessionId,
    issueId,
    pipelineName,
    status: 'queued',
    currentStage: 'queued',
    progress: 0,
    attempt: 1,
    maxAttempts,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
  };
}

export function transitionState(state: SessionState, toStage: PipelineStage): SessionState {
  if (!isValidTransition(state.currentStage, toStage)) {
    log.warn({ from: state.currentStage, to: toStage, sessionId: state.sessionId }, 'Invalid state transition');
    return state;
  }

  const newStatus: PipelineStatus = toStage === 'completed' ? 'completed' : 'running';

  const updated: SessionState = {
    ...state,
    currentStage: toStage,
    status: newStatus,
    progress: calculateProgress(toStage, newStatus),
    updatedAt: Date.now(),
    startedAt: state.startedAt ?? (toStage !== 'queued' ? Date.now() : undefined),
    completedAt: newStatus === 'completed' ? Date.now() : undefined,
  };

  log.info(
    { sessionId: state.sessionId, from: state.currentStage, to: toStage, status: newStatus },
    'State transition',
  );

  return updated;
}

export function failState(state: SessionState, error: string): SessionState {
  const updated: SessionState = {
    ...state,
    status: 'failed',
    error,
    progress: calculateProgress(state.currentStage, 'failed'),
    updatedAt: Date.now(),
    completedAt: Date.now(),
  };
  log.error({ sessionId: state.sessionId, stage: state.currentStage, error }, 'Pipeline failed');
  return updated;
}

export function cancelState(state: SessionState): SessionState {
  const updated: SessionState = {
    ...state,
    status: 'cancelled',
    progress: calculateProgress(state.currentStage, 'cancelled'),
    updatedAt: Date.now(),
    completedAt: Date.now(),
  };
  log.info({ sessionId: state.sessionId }, 'Pipeline cancelled');
  return updated;
}

export function retryState(state: SessionState): SessionState | null {
  if (state.attempt >= state.maxAttempts) {
    log.warn({ sessionId: state.sessionId, attempt: state.attempt }, 'Max retry attempts reached');
    return null;
  }
  const updated: SessionState = {
    ...state,
    status: 'running',
    currentStage: 'queued',
    progress: 0,
    attempt: state.attempt + 1,
    error: undefined,
    updatedAt: Date.now(),
    completedAt: undefined,
  };
  log.info({ sessionId: state.sessionId, attempt: updated.attempt }, 'Pipeline retrying');
  return updated;
}

/**
 * Convert a PipelinePhase name ('pre', 'main', 'post', 'final') to its
 * corresponding PipelineStage ('phase_pre', 'phase_main', etc.).
 * Returns null for unknown phase names.
 */
export function getPhaseStage(phase: string): PipelineStage | null {
  return PHASE_STAGE_MAP[phase as PipelinePhase] ?? null;
}

/**
 * Return the ordered list of phase stages that exist between queued and completed.
 * Useful for progress calculation in template-driven pipelines.
 */
export function getPhaseStagesInOrder(): PipelineStage[] {
  return ['phase_pre', 'phase_main', 'phase_post', 'phase_final'];
}

export { STAGE_ORDER, VALID_TRANSITIONS, PHASE_STAGE_MAP };
