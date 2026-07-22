export type PipelinePhase = 'pre' | 'main' | 'post' | 'final';

export type PipelineStage =
  | 'queued'
  | 'triage'
  | 'workspace'
  | 'agent'
  | 'verification'
  | 'self_audit'
  | 'anti_mockup'
  | 'pr_creation'
  | 'review'
  | 'cleanup'
  | 'phase_pre'
  | 'phase_main'
  | 'phase_post'
  | 'phase_final'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PipelineStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PhaseStepResult {
  /** Whether the operation succeeded. */
  success: boolean;
  /** True when all phases and steps are complete. */
  completed: boolean;
  /** The resolved command to execute, if there is a next step. */
  command?: string;
  /** Which phase this step belongs to. */
  phase?: PipelinePhase;
  /** Step index within the phase. */
  stepIndex?: number;
  /** Total steps in this phase. */
  stepTotal?: number;
  /** Error message on failure. */
  error?: string;
  /** The current session state after the operation. */
  session?: SessionState;
}

export interface PhaseStepInfo {
  phase: PipelinePhase;
  stepIndex: number;
  command: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'budget_exhausted' | 'stuck';
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface SessionState {
  sessionId: string;
  issueId: string;
  pipelineName: string;
  status: PipelineStatus;
  currentStage: PipelineStage;
  progress: number;
  attempt: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  metadata: Record<string, unknown>;
  /** Template-driven phase tracking — set when using template-based execution. */
  templateName?: string;
  /** Ordered list of phases to execute (subset of pre/main/post/final). */
  phaseOrder?: PipelinePhase[];
  /** Index into phaseOrder for the currently active phase. */
  currentPhaseIndex?: number;
  /** Step index within the current phase. */
  currentStepIndex?: number;
  /** Detailed history of every phase step executed. */
  phaseHistory?: PhaseStepInfo[];
}

export interface SessionEvent {
  event: string;
  timestamp: number;
  sessionId: string;
  stage: PipelineStage;
  data?: Record<string, unknown>;
}

export interface WebhookConfig {
  url: string;
  secret?: string;
  events: string[];
  headers?: Record<string, string>;
  retryCount?: number;
  retryDelayMs?: number;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  payload: unknown;
  responseStatus?: number;
  error?: string;
  attemptedAt: string;
  deliveredAt?: string;
  retryCount: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineParams = {
  learning_rate: 0.001,
  batch_size: 64,
  feature_set: 'default',
};

export interface PipelineParams {
  learning_rate: number;
  batch_size: number;
  feature_set: string;
  [key: string]: unknown;
}

export interface PipelineConfigRun {
  id: string;
  pipelineId: string;
  version: number;
  parentVersion?: number;
  configBlob: PipelineParams;
  metrics?: Record<string, number>;
  datasetHash?: string;
  ticketId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Hard cost/token cap per pipeline run.
 */
export interface CostBudget {
  maxTokens: number;
  maxCostUsd: number;
}

/**
 * Per-pipeline-template tool restrictions passed to OpenCode.
 */
export interface ToolAllowlist {
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
}

/**
 * Agent confinement configuration for a pipeline.
 */
export interface ConfinementConfig {
  costBudget?: CostBudget;
  toolAllowlist?: ToolAllowlist;
  loopDetectionEnabled: boolean;
  deadEndDetectionEnabled: boolean;
}

/**
 * Record of a phase's output for loop/dead-end detection.
 */
export interface PhaseOutputRecord {
  phase: PipelinePhase;
  output: string;
  error?: string;
  tokenCost?: number;
}

// ── Pipeline Progress Event Types ──────────────────────────────────────

export type PipelineProgressEvent =
  | 'pipeline.started'
  | 'pipeline.completed'
  | 'pipeline.failed'
  | 'stage.started'
  | 'stage.completed';

export interface PipelineProgressPayload {
  event: PipelineProgressEvent;
  runId: string;
  stage?: string;
  template?: string;
  model?: string;
  message?: string;
  detail?: string;
  duration?: number;
  confidence?: string;
  prUrl?: string;
  error?: string;
  timestamp: string;
}

// ── OpenSymphony Stage Result Types ───────────────────────────────────

export interface IntentResult {
  issueType: 'bug_fix' | 'feature_request' | 'question' | 'unknown';
  complexity: 'simple' | 'medium' | 'complex';
  repoOwner?: string;
  repoName?: string;
  issueNumber?: number;
  summary: string;
}

export interface PlanningResult {
  reproductionSteps: string[];
  rootCauseHypothesis: string;
  affectedFiles: string[];
  approach: string;
}

export interface ExecutionResult {
  success: boolean;
  summary: string;
  diff?: string;
  branchName?: string;
  testOutput?: string;
  errors?: string[];
  metadata?: Record<string, unknown>;
}

export interface CollectionResult {
  diff: string;
  branchName: string;
  testOutput: string;
  prUrl?: string;
  qualityGatesPassed: boolean;
  qualityGateDetails?: string;
}

export interface TasteResult {
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  testsPassed: boolean;
  realDiffProduced: boolean;
  qualityGatesPassed: boolean;
}

// ── Pipeline Template Types ──────────────────────────────────────────

export type PipelineTemplateId = 'fast' | 'full';

export interface PipelineTemplate {
  id: PipelineTemplateId;
  stages: string[];
  description: string;
}

export const PIPELINE_TEMPLATES: Record<PipelineTemplateId, PipelineTemplate> = {
  fast: {
    id: 'fast',
    stages: ['intent', 'execute', 'taste'],
    description: 'Fast pipeline — intent classification, direct execution, quality taste',
  },
  full: {
    id: 'full',
    stages: ['intent', 'plan', 'execute', 'collect', 'taste'],
    description: 'Full pipeline — intent, planning, execution, result collection, quality taste',
  },
};
