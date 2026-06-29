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
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PipelineStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

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
