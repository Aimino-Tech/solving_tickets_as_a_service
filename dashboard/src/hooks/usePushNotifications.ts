import { useState, useEffect, useCallback } from 'react';
import {
  subscribe,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  fetchNotifications,
  startPolling,
  stopPolling,
  type Notification,
} from '@/services/notificationService';

export type PermissionState = 'default' | 'granted' | 'denied';

export function usePushNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(getNotifications());
  const [unreadCount, setUnreadCount] = useState(0);
  const [permission, setPermission] = useState<PermissionState>(
    typeof Notification !== 'undefined' ? (Notification.permission as PermissionState) : 'denied',
  );

  useEffect(() => {
    startPolling();
    const unsubscribe = subscribe((updated) => {
      setNotifications(updated);
      getUnreadCount().then(setUnreadCount);
    });
    getUnreadCount().then(setUnreadCount);
    fetchNotifications();
    return () => {
      unsubscribe();
      stopPolling();
    };
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
      if (permission !== 'granted' || typeof Notification === 'undefined') return;
      try {
        new Notification(notification.title, {
          body: notification.body,
          icon: '/favicon.ico',
          tag: String(notification.id),
        });
      } catch {}
    },
    [permission],
  );

  return {
    notifications,
    unreadCount,
    permission,
    requestPermission,
    markAsRead,
    markAllAsRead,
    fetchNotifications,
  };
}
