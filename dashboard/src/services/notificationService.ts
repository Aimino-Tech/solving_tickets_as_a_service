export interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'pipeline_event' | 'system' | 'alert';
  timestamp: Date;
  read: boolean;
  data?: Record<string, unknown>;
}

type NotificationListener = (notifications: Notification[]) => void;

const notifications: Notification[] = [];
const listeners: Set<NotificationListener> = new Set();

function notifyListeners() {
  listeners.forEach((listener) => listener([...notifications]));
}

function generateId(): string {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function addNotification(
  notification: Omit<Notification, 'id' | 'timestamp' | 'read'>,
): Notification {
  const newNotification: Notification = {
    ...notification,
    id: generateId(),
    timestamp: new Date(),
    read: false,
  };
  notifications.unshift(newNotification);
  notifyListeners();
  return newNotification;
}

export function markAsRead(id: string): void {
  const notification = notifications.find((n) => n.id === id);
  if (notification) {
    notification.read = true;
    notifyListeners();
  }
}

export function markAllAsRead(): void {
  notifications.forEach((n) => {
    n.read = true;
  });
  notifyListeners();
}

export function clearAll(): void {
  notifications.length = 0;
  notifyListeners();
}

export function getNotifications(): Notification[] {
  return [...notifications];
}

export function getUnreadCount(): number {
  return notifications.filter((n) => !n.read).length;
}

export function subscribe(listener: NotificationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function simulatePipelineEvent(
  event: 'started' | 'completed' | 'failed',
  runId: string,
  repoName?: string,
): Notification {
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

  return addNotification({
    type: 'pipeline_event',
    ...messages[event],
    data: { runId, repoName, event },
  });
}
