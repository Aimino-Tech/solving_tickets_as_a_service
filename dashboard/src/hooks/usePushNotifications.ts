import { useState, useEffect, useCallback } from 'react';
import {
  addNotification,
  subscribe,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  clearAll,
  type Notification,
} from '@/services/notificationService';

export type PermissionState = 'default' | 'granted' | 'denied';

export function usePushNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(getNotifications());
  const [unreadCount, setUnreadCount] = useState(getUnreadCount());
  const [permission, setPermission] = useState<PermissionState>(
    typeof Notification !== 'undefined' ? (Notification.permission as PermissionState) : 'denied',
  );

  useEffect(() => {
    const unsubscribe = subscribe((updated) => {
      setNotifications(updated);
      setUnreadCount(getUnreadCount());
    });
    return unsubscribe;
  }, []);

  const requestPermission = useCallback(async (): Promise<PermissionState> => {
    if (typeof Notification === 'undefined') {
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);
      return result as PermissionState;
    } catch {
      return 'denied';
    }
  }, []);

  const showBrowserNotification = useCallback(
    (notification: Notification) => {
      if (permission !== 'granted' || typeof Notification === 'undefined') {
        return;
      }
      try {
        new Notification(notification.title, {
          body: notification.body,
          icon: '/favicon.ico',
          tag: notification.id,
        });
      } catch {
        // Browser may not support notifications
      }
    },
    [permission],
  );

  const notify = useCallback(
    (params: { title: string; body: string; type: Notification['type']; data?: Record<string, unknown> }) => {
      const notification = addNotification(params);
      showBrowserNotification(notification);
      return notification;
    },
    [showBrowserNotification],
  );

  return {
    notifications,
    unreadCount,
    permission,
    requestPermission,
    markAsRead,
    markAllAsRead,
    clearAll,
    notify,
  };
}
