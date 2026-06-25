/**
 * Base types for the notification system.
 *
 * Defines the event types and data contract that all notification
 * implementations (Slack, email, etc.) must satisfy.
 */

export type NotificationEvent =
  | 'fix_started'
  | 'pr_created'
  | 'fix_failed'
  | 'verification_failed'
  | 'error'
  | 'payment_failed'
  | 'payment_recovered'
  | 'dlq_alert';

export interface NotificationData {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  prUrl?: string;
  reason?: string;
  errorMessage?: string;
  botName?: string;
  /** Optional: email address for direct notification */
  email?: string;
  /** Optional: Slack user/channel ID for direct message */
  slackTarget?: string;
  /** Optional: additional structured metadata for the notification */
  metadata?: Record<string, unknown>;
}

export interface NotificationService {
  sendNotification(
    event: NotificationEvent,
    data: NotificationData,
  ): Promise<void>;
}
