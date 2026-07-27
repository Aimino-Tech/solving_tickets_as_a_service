export interface NotificationPreference {
  id: number;
  userId: number;
  channel: 'email' | 'slack' | 'discord' | 'webhook' | 'in_app';
  eventType: string;
  enabled: boolean;
  channelTarget: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewNotificationPreference {
  userId: number;
  channel: 'email' | 'slack' | 'discord' | 'webhook' | 'in_app';
  eventType: string;
  enabled?: boolean;
  channelTarget?: string | null;
}

export interface NotificationHistory {
  id: number;
  userId: number;
  eventType: string;
  channel: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}

export interface NewNotificationHistory {
  userId: number;
  eventType: string;
  channel: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}
