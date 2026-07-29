export interface RunFeedback {
  id: number;
  runId: string;
  userId: string;
  verdict: 'good' | 'bad_fix' | 'not_working';
  comment: string | null;
  feedbackType: 'user' | 'auto' | 'escalation' | 'rollback' | 'retry';
  reanalysisRunId: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface NewRunFeedback {
  runId: string;
  userId: string;
  verdict: 'good' | 'bad_fix' | 'not_working';
  comment?: string | null;
  feedbackType?: 'user' | 'auto' | 'escalation' | 'rollback' | 'retry';
  reanalysisRunId?: number | null;
  metadata?: Record<string, unknown>;
}
