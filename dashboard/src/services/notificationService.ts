import { request } from '@/api/client';

export interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'pipeline_event' | 'system' | 'alert';
  timestamp: Date;
  read: boolean;
  data?: Record<string, unknown>;
}

export interface NotificationPreference {
  id: number;
  userId: number;
  channel: 'email' | 'slack' | 'discord' | 'webhook' | 'in_app';
  eventType: string;
  enabled: boolean;
  channelTarget: string | null;
  createdAt: string;
  updatedAt: string;
}

type NotificationListener = (notifications: Notification[]) => void;

const localNotifications: Notification[] = [];
const listeners: Set<NotificationListener> = new Set();
let pollInterval: ReturnType<typeof setInterval> | null = null;

function notifyListeners() {
  listeners.forEach((listener) => listener([...localNotifications]));
}

function generateId(): string {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function fetchHistory(limit = 50, offset = 0, unreadOnly = false): Promise<void> {
  try {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (unreadOnly) params.set('unread', 'true');
    const data = await request<{ rows: Notification[]; total: number }>(
      `/v1/notifications/history?${params.toString()}`,
    );
    const mapped = data.rows.map((n: any) => ({
      id: String(n.id),
      title: n.title,
      body: n.body,
      type: n.event_type === 'pr_created' || n.event_type === 'fix_started' || n.event_type === 'fix_completed' || n.event_type === 'pipeline_failed'
        ? 'pipeline_event' as const
        : n.event_type === 'low_credits' || n.event_type === 'payment_failed'
          ? 'alert' as const
          : 'system' as const,
      timestamp: new Date(n.created_at),
      read: n.read,
      data: n.metadata,
    }));
    const localOnly = localNotifications.filter((n) => n.id.startsWith('notif_'));
    localNotifications.length = 0;
    localNotifications.push(...mapped, ...localOnly);
    notifyListeners();
  } catch {
    // Backend unavailable, keep local notifications
  }
}

export function startPolling(intervalMs = 30000): void {
  stopPolling();
  fetchHistory();
  pollInterval = setInterval(() => fetchHistory(), intervalMs);
}

export function stopPolling(): void {
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

export async function addNotification(
  notification: Omit<Notification, 'id' | 'timestamp' | 'read'>,
): Promise<Notification> {
  const newNotification: Notification = {
    ...notification,
    id: generateId(),
    timestamp: new Date(),
    read: false,
  };
  localNotifications.unshift(newNotification);
  notifyListeners();
  return newNotification;
}

export async function markAsRead(id: string): Promise<void> {
  const notification = localNotifications.find((n) => n.id === id);
  if (notification) {
    notification.read = true;
    notifyListeners();
  }
  try {
    await request(`/v1/notifications/history/${id}/read`, { method: 'PUT' });
  } catch {
    // Silent fail
  }
}

export async function markAllAsRead(): Promise<void> {
  localNotifications.forEach((n) => {
    n.read = true;
  });
  notifyListeners();
  try {
    await request('/v1/notifications/history/read-all', { method: 'PUT' });
  } catch {
    // Silent fail
  }
}

export function clearAll(): void {
  localNotifications.length = 0;
  notifyListeners();
}

export function getNotifications(): Notification[] {
  return [...localNotifications];
}

export function getUnreadCount(): number {
  return localNotifications.filter((n) => !n.read).length;
}

export function subscribe(listener: NotificationListener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    startPolling();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopPolling();
    }
  };
}

export async function fetchPreferences(): Promise<NotificationPreference[]> {
  try {
    const data = await request<{ preferences: NotificationPreference[] }>('/v1/notifications/preferences');
    return data.preferences;
  } catch {
    return [];
  }
}

export async function upsertPreference(
  channel: NotificationPreference['channel'],
  eventType: string,
  enabled: boolean,
  channelTarget?: string,
): Promise<NotificationPreference | null> {
  try {
    const data = await request<{ preference: NotificationPreference }>('/v1/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({ channel, eventType, enabled, channelTarget }),
    });
    return data.preference;
  } catch {
    return null;
  }
}

export function simulatePipelineEvent(
  event: 'started' | 'completed' | 'failed',
  runId: string,
  repoName?: string,
): void {
  const messages: Record<string, { title: string; body: string }> = {
    started: {
      title: 'Pipeline Started',
      body: `Fix run ${runId}${repoName ? ` for ${repoName}` : ''} has started.`,
    },
    completed: {
      title: 'Pipeline Completed',
      body: `Fix run ${runId}${repoName ? ` for ${repoName}` : ''} completed successfully.`,
    },
    failed: {
      title: 'Pipeline Failed',
      body: `Fix run ${runId}${repoName ? ` for ${repoName}` : ''} has failed.`,
    },
  };

  addNotification({
    type: 'pipeline_event',
    ...messages[event],
    data: { runId, repoName, event },
  });
}
