export interface RunFeedback {
  id: number;
  runId: number;
  userId: string;
  verdict: string;
  comment: string | null;
  feedbackType: string;
  reanalysisRunId: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface NewRunFeedback {
  runId: number;
  userId: string;
  verdict?: string;
  comment?: string | null;
  feedbackType?: string;
  reanalysisRunId?: number | null;
  metadata?: Record<string, unknown>;
}
