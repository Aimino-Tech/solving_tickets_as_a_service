import { queryWithRetry } from '../connection.js';
import type { RunFeedback, NewRunFeedback } from '../types/runFeedback.js';

export class RunFeedbackRepository {
  async findByRunId(runId: string): Promise<RunFeedback[]> {
    const result = await queryWithRetry<RunFeedback>('SELECT * FROM run_feedback WHERE run_id = $1 ORDER BY created_at DESC', [runId]);
    return result.rows;
  }

  async findByUserId(userId: number, limit = 50, offset = 0): Promise<RunFeedback[]> {
    const result = await queryWithRetry<RunFeedback>('SELECT * FROM run_feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, limit, offset]);
    return result.rows;
  }

  async create(data: NewRunFeedback): Promise<RunFeedback> {
    const result = await queryWithRetry<RunFeedback>(
      `INSERT INTO run_feedback (run_id, user_id, verdict, comment, feedback_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.runId, data.userId, data.verdict, data.comment ?? null, data.feedbackType ?? 'user', JSON.stringify(data.metadata ?? {})],
    );
    return result.rows[0];
  }

  async getLatestFeedback(runId: string): Promise<RunFeedback | undefined> {
    const result = await queryWithRetry<RunFeedback>('SELECT * FROM run_feedback WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1', [runId]);
    return result.rows[0];
  }
}

export const runFeedbackRepository = new RunFeedbackRepository();
