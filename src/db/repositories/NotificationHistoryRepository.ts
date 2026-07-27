import { queryWithRetry } from '../connection.js';
import type { NotificationHistory, NewNotificationHistory } from '../types/index.js';

export class NotificationHistoryRepository {
  async insert(data: NewNotificationHistory): Promise<NotificationHistory> {
    const result = await queryWithRetry<NotificationHistory>(
      `INSERT INTO notification_history (user_id, event_type, channel, title, body, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.userId,
        data.eventType,
        data.channel ?? 'in_app',
        data.title ?? null,
        data.body ?? null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ],
    );
    return result.rows[0];
  }
}

export const notificationHistoryRepository = new NotificationHistoryRepository();
