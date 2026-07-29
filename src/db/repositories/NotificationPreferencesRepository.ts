import { queryWithRetry } from '../connection.js';
import type { NotificationPreference, NewNotificationPreference } from '../types/notifications.js';

export class NotificationPreferencesRepository {
  async findByUser(userId: string): Promise<NotificationPreference[]> {
    const result = await queryWithRetry<NotificationPreference>(
      `SELECT id, user_id, channel, event_type, enabled, channel_target, created_at, updated_at
       FROM notification_preferences WHERE user_id = $1
       ORDER BY event_type, channel`,
      [userId],
    );
    return result.rows;
  }

  async upsert(data: NewNotificationPreference): Promise<NotificationPreference> {
    const result = await queryWithRetry<NotificationPreference>(
      `INSERT INTO notification_preferences (user_id, channel, event_type, enabled, channel_target)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, channel, event_type)
       DO UPDATE SET enabled = $4, channel_target = COALESCE($5, notification_preferences.channel_target), updated_at = NOW()
       RETURNING id, user_id, channel, event_type, enabled, channel_target, created_at, updated_at`,
      [data.userId, data.channel, data.eventType, data.enabled ?? true, data.channelTarget ?? null],
    );
    return result.rows[0];
  }

  async delete(userId: string, channel: string, eventType: string): Promise<void> {
    await queryWithRetry(
      `DELETE FROM notification_preferences WHERE user_id = $1 AND channel = $2 AND event_type = $3`,
      [userId, channel, eventType],
    );
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await queryWithRetry(
      `DELETE FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
  }
}

export const notificationPreferencesRepository = new NotificationPreferencesRepository();
