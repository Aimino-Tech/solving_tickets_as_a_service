import { request } from '@/api/client';

export interface Notification {
  id: number;
  userId: number;
  eventType: string;
  channel: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export interface Preference {
  id: number;
  userId: number;
  channel: string;
  eventType: string;
  enabled: boolean;
  channelTarget: string | null;
}

type NotificationListener = (notifications: Notification[]) => void;

let cachedNotifications: Notification[] = [];
const listeners: Set<NotificationListener> = new Set();
let pollingInterval: ReturnType<typeof setInterval> | null = null;

function notifyListeners() {
  listeners.forEach((listener) => listener([...cachedNotifications]));
}

export async function fetchNotifications(limit = 50, unreadOnly = false): Promise<Notification[]> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (unreadOnly) params.set('unread', 'true');
    const data = await request<{ rows: Notification[]; total: number }>(
      `/v1/notifications/history?${params.toString()}`,
    );
    cachedNotifications = data.rows;
    notifyListeners();
    return data.rows;
  } catch {
    return cachedNotifications;
  }
}

export async function markAsRead(id: number): Promise<void> {
  try {
    await request(`/v1/notifications/history/${id}/read`, { method: 'PUT' });
    const notif = cachedNotifications.find((n) => n.id === id);
    if (notif) notif.read = true;
    notifyListeners();
  } catch {}
}

export async function markAllAsRead(): Promise<void> {
  try {
    await request('/v1/notifications/history/read-all', { method: 'PUT' });
    cachedNotifications.forEach((n) => { n.read = true; });
    notifyListeners();
  } catch {}
}

export async function getUnreadCount(): Promise<number> {
  try {
    const data = await request<{ rows: Notification[]; total: number }>(
      '/v1/notifications/history?unread=true&limit=1',
    );
    return data.total;
  } catch {
    return 0;
  }
}

export function getNotifications(): Notification[] {
  return [...cachedNotifications];
}

export function subscribe(listener: NotificationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startPolling(intervalMs = 30000): void {
  if (pollingInterval) return;
  fetchNotifications();
  pollingInterval = setInterval(() => fetchNotifications(), intervalMs);
}

export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
