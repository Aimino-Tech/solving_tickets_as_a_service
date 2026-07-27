export interface NotificationHistory {
  id: number;
  userId: number;
  eventType: string;
  channel: string;
  title: string | null;
  body: string | null;
  metadata: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NewNotificationHistory {
  userId: number;
  eventType: string;
  channel?: string;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown>;
}
