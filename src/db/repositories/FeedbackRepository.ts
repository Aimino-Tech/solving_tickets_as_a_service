import { queryWithRetry } from '../connection.js';
import type { Feedback, NewFeedback } from '../types/index.js';

export class FeedbackRepository {
  async create(data: NewFeedback): Promise<Feedback> {
    const result = await queryWithRetry<Feedback>(
      `INSERT INTO feedback (run_id, user_id, rating, comment, action)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.runId, data.userId, data.rating, data.comment ?? '', data.action ?? 'none'],
    );
    return result.rows[0];
  }

  async findByRun(runId: number): Promise<Feedback[]> {
    const result = await queryWithRetry<Feedback>(
      'SELECT * FROM feedback WHERE run_id = $1 ORDER BY created_at DESC',
      [runId],
    );
    return result.rows;
  }

  async findById(id: number): Promise<Feedback | undefined> {
    const result = await queryWithRetry<Feedback>('SELECT * FROM feedback WHERE id = $1', [id]);
    return result.rows[0];
  }

  async resolve(id: number): Promise<void> {
    await queryWithRetry(
      `UPDATE feedback SET resolved = TRUE, updated_at = NOW() WHERE id = $1`,
      [id],
    );
  }
}

export const feedbackRepository = new FeedbackRepository();
