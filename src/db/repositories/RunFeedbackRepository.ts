import { queryWithRetry } from '../connection.js';
import type { RunFeedback, NewRunFeedback } from '../types/feedback.js';

export class RunFeedbackRepository {
  async findByRunId(runId: number): Promise<RunFeedback[]> {
    const result = await queryWithRetry<RunFeedback>(
      'SELECT id, run_id as "runId", user_id as "userId", verdict, comment, feedback_type as "feedbackType", reanalysis_run_id as "reanalysisRunId", metadata, created_at as "createdAt" FROM run_feedback WHERE run_id = $1 ORDER BY created_at DESC',
      [runId],
    );
    return result.rows;
  }

  async create(data: NewRunFeedback): Promise<RunFeedback> {
    const result = await queryWithRetry<RunFeedback>(
      `INSERT INTO run_feedback (run_id, user_id, verdict, comment, feedback_type, reanalysis_run_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, run_id as "runId", user_id as "userId", verdict, comment, feedback_type as "feedbackType", reanalysis_run_id as "reanalysisRunId", metadata, created_at as "createdAt"`,
      [data.runId, data.userId, data.verdict ?? 'bad_fix', data.comment ?? null, data.feedbackType ?? 'user', data.reanalysisRunId ?? null, JSON.stringify(data.metadata ?? {})],
    );
    return result.rows[0];
  }
}

export const runFeedbackRepository = new RunFeedbackRepository();
