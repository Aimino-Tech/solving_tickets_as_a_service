import { queryWithRetry } from '../connection.js';
import type { NotificationHistory, NewNotificationHistory } from '../types/index.js';

export class NotificationHistoryRepository {
  async findByUser(
    userId: number,
    limit = 50,
    offset = 0,
    unreadOnly = false,
  ): Promise<{ rows: NotificationHistory[]; total: number }> {
    const whereClause = unreadOnly ? 'WHERE user_id = $1 AND read = FALSE' : 'WHERE user_id = $1';
    const countResult = await queryWithRetry<{ total: number }>(
      `SELECT COUNT(*) as total FROM notification_history ${whereClause}`,
      unreadOnly ? [userId] : [userId],
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const result = await queryWithRetry<NotificationHistory>(
      `SELECT id, user_id, event_type, channel, title, body, metadata, read, created_at
       FROM notification_history ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${unreadOnly ? 2 : 2} OFFSET $${unreadOnly ? 3 : 3}`,
      unreadOnly ? [userId, limit, offset] : [userId, limit, offset],
    );
    return { rows: result.rows, total };
  }

  async create(data: NewNotificationHistory): Promise<NotificationHistory> {
    const result = await queryWithRetry<NotificationHistory>(
      `INSERT INTO notification_history (user_id, event_type, channel, title, body, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, event_type, channel, title, body, metadata, read, created_at`,
      [data.userId, data.eventType, data.channel, data.title, data.body ?? '', JSON.stringify(data.metadata ?? {})],
    );
    return result.rows[0];
  }

  async markRead(id: number, userId: number): Promise<void> {
    await queryWithRetry(
      `UPDATE notification_history SET read = TRUE WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
  }

  async markAllRead(userId: number): Promise<void> {
    await queryWithRetry(
      `UPDATE notification_history SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
      [userId],
    );
  }

  async deleteOld(userId: number, beforeDays = 90): Promise<number> {
    const result = await queryWithRetry<{ deleted: number }>(
      `DELETE FROM notification_history WHERE user_id = $1 AND created_at < NOW() - make_interval(days => $2)
       RETURNING id`,
      [userId, beforeDays],
    );
    return result.rowCount ?? 0;
  }
}

export const notificationHistoryRepository = new NotificationHistoryRepository();
