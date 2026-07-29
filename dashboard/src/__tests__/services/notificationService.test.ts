import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as notificationService from '@/services/notificationService';

vi.mock('@/api/client', () => ({ request: vi.fn() }));

type Unsubscribe = () => void;

describe('notificationService', () => {
  let mockRequest: ReturnType<typeof vi.fn>;
  const subs: Unsubscribe[] = [];

  function sub(fn: () => void): Unsubscribe {
    const u = notificationService.subscribe(fn);
    subs.push(u);
    return u;
  }

  beforeEach(async () => {
    const client = await import('@/api/client');
    mockRequest = client.request as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
    notificationService.clearAll();
    notificationService.stopPolling();
  });

  afterEach(() => {
    for (const u of subs.splice(0)) u();
    vi.useRealTimers();
  });

  describe('fetchHistory', () => {
    it('maps API response correctly', async () => {
      mockRequest.mockResolvedValue({
        rows: [
          { id: 1, title: 'Pipeline Complete', body: 'Fix completed successfully', event_type: 'fix_completed', created_at: '2024-06-15T10:30:00Z', read: false, metadata: { runId: 'abc' } },
          { id: 2, title: 'Low Credits', body: 'Balance is low', event_type: 'low_credits', created_at: '2024-06-15T11:00:00Z', read: true, metadata: null },
        ],
        total: 2,
      });

      await notificationService.fetchHistory();

      expect(mockRequest).toHaveBeenCalledWith('/v1/notifications/history?limit=50&offset=0');
      const notifications = notificationService.getNotifications();
      expect(notifications).toHaveLength(2);
      expect(notifications[0]).toMatchObject({
        id: '1', title: 'Pipeline Complete', body: 'Fix completed successfully',
        type: 'pipeline_event', read: false, data: { runId: 'abc' },
      });
      expect(notifications[0].timestamp).toEqual(new Date('2024-06-15T10:30:00Z'));
      expect(notifications[1].type).toBe('alert');
      expect(notifications[1].read).toBe(true);
    });

    it('sends unreadOnly param when true', async () => {
      mockRequest.mockResolvedValue({ rows: [], total: 0 });

      await notificationService.fetchHistory(10, 0, true);

      expect(mockRequest).toHaveBeenCalledWith('/v1/notifications/history?limit=10&offset=0&unread=true');
    });

    it('preserves local-only notifications when API succeeds', async () => {
      mockRequest.mockResolvedValue({ rows: [{ id: 99, title: 'API', body: 'B', event_type: 'system', created_at: '2024-01-01T00:00:00Z', read: true, metadata: null }], total: 1 });

      await notificationService.addNotification({ title: 'Local', body: 'L', type: 'system' });
      expect(notificationService.getNotifications()).toHaveLength(1);

      await notificationService.fetchHistory();

      const all = notificationService.getNotifications();
      expect(all).toHaveLength(2);
      expect(all[0].title).toBe('API');
      expect(all[1].title).toBe('Local');
      expect(all[1].id).toMatch(/^notif_/);
    });

    it('handles API error gracefully and keeps local notifications', async () => {
      mockRequest.mockRejectedValue(new Error('Network error'));
      await notificationService.addNotification({ title: 'Surviving', body: 'Still here', type: 'alert' });

      await notificationService.fetchHistory();

      expect(notificationService.getNotifications()).toHaveLength(1);
      expect(notificationService.getNotifications()[0].title).toBe('Surviving');
    });
  });

  describe('addNotification', () => {
    it('adds a notification with generated id and timestamp', async () => {
      const result = await notificationService.addNotification({ title: 'New', body: 'Body', type: 'alert' });

      expect(result.id).toMatch(/^notif_/);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.read).toBe(false);
      expect(result.title).toBe('New');
      expect(result.type).toBe('alert');
      expect(notificationService.getNotifications()).toHaveLength(1);
    });

    it('notifies subscribers', async () => {
      const listener = vi.fn();
      sub(listener);

      await notificationService.addNotification({ title: 'Notify', body: 'Me', type: 'system' });

      expect(listener).toHaveBeenCalledTimes(1);
      const received = listener.mock.calls[0][0];
      expect(received).toHaveLength(1);
      expect(received[0].title).toBe('Notify');
    });
  });

  describe('markAsRead', () => {
    it('marks a notification read locally and calls API', async () => {
      mockRequest.mockResolvedValue({});
      await notificationService.addNotification({ title: 'Unread', body: 'B', type: 'system' });

      const notif = notificationService.getNotifications()[0];
      expect(notif.read).toBe(false);

      await notificationService.markAsRead(notif.id);

      expect(notificationService.getNotifications()[0].read).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith(`/v1/notifications/history/${notif.id}/read`, { method: 'PUT' });
    });

    it('silent-fails API error and still marks locally', async () => {
      mockRequest.mockRejectedValue(new Error('API down'));
      await notificationService.addNotification({ title: 'Unread', body: 'B', type: 'system' });
      const notif = notificationService.getNotifications()[0];

      await notificationService.markAsRead(notif.id);

      expect(notificationService.getNotifications()[0].read).toBe(true);
    });

    it('does nothing when id not found', async () => {
      await expect(notificationService.markAsRead('nonexistent')).resolves.toBeUndefined();
    });

    it('notifies subscribers when marked', async () => {
      mockRequest.mockResolvedValue({});
      await notificationService.addNotification({ title: 'T', body: 'B', type: 'system' });
      const id = notificationService.getNotifications()[0].id;
      const listener = vi.fn();
      sub(listener);

      await notificationService.markAsRead(id);

      expect(listener).toHaveBeenCalled();
      const received = listener.mock.calls[0][0];
      expect(received[0].read).toBe(true);
    });
  });

  describe('markAllAsRead', () => {
    it('marks all notifications read and calls API', async () => {
      mockRequest.mockResolvedValue({});
      await notificationService.addNotification({ title: 'A', body: '1', type: 'system' });
      await notificationService.addNotification({ title: 'B', body: '2', type: 'system' });

      await notificationService.markAllAsRead();

      expect(notificationService.getNotifications().every((n) => n.read)).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith('/v1/notifications/history/read-all', { method: 'PUT' });
    });

    it('silent-fails API error and still marks all locally', async () => {
      mockRequest.mockRejectedValue(new Error('fail'));
      await notificationService.addNotification({ title: 'A', body: '1', type: 'system' });
      await notificationService.addNotification({ title: 'B', body: '2', type: 'system' });

      await notificationService.markAllAsRead();

      expect(notificationService.getNotifications().every((n) => n.read)).toBe(true);
    });
  });

  describe('clearAll', () => {
    it('removes all local notifications', async () => {
      await notificationService.addNotification({ title: 'A', body: '1', type: 'system' });
      await notificationService.addNotification({ title: 'B', body: '2', type: 'alert' });
      expect(notificationService.getNotifications()).toHaveLength(2);

      notificationService.clearAll();

      expect(notificationService.getNotifications()).toHaveLength(0);
    });
  });

  describe('getNotifications / getUnreadCount', () => {
    it('returns a copy of notifications', async () => {
      await notificationService.addNotification({ title: 'A', body: '1', type: 'system' });
      const copy = notificationService.getNotifications();
      copy.pop();
      expect(notificationService.getNotifications()).toHaveLength(1);
    });

    it('getUnreadCount returns correct count', async () => {
      await notificationService.addNotification({ title: 'A', body: '1', type: 'system' });
      await notificationService.addNotification({ title: 'B', body: '2', type: 'alert' });
      expect(notificationService.getUnreadCount()).toBe(2);
      mockRequest.mockResolvedValue({});
      await notificationService.markAsRead(notificationService.getNotifications()[0].id);
      expect(notificationService.getUnreadCount()).toBe(1);
    });
  });

  describe('subscribe / polling', () => {
    it('returns an unsubscribe function', () => {
      const listen = vi.fn();
      const unsub = notificationService.subscribe(listen);
      expect(unsub).toBeInstanceOf(Function);
      unsub();
    });

    it('starts polling when the first listener is added', async () => {
      mockRequest.mockResolvedValue({ rows: [], total: 0 });

      sub(vi.fn());

      await vi.waitFor(() => {
        expect(mockRequest).toHaveBeenCalledWith('/v1/notifications/history?limit=50&offset=0');
      });
    });

    it('does not start polling for second listener', () => {
      mockRequest.mockResolvedValue({ rows: [], total: 0 });
      sub(vi.fn());
      mockRequest.mockClear();

      sub(vi.fn());

      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('stops polling when the last listener unsubscribes', async () => {
      vi.useFakeTimers();
      mockRequest.mockResolvedValue({ rows: [], total: 0 });

      const unsub = notificationService.subscribe(vi.fn());
      await vi.waitFor(() => {
        expect(mockRequest).toHaveBeenCalledTimes(1);
      });
      mockRequest.mockClear();

      unsub();
      vi.advanceTimersByTime(60000);

      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('calls listener on notification changes', async () => {
      const listener = vi.fn();
      sub(listener);

      await notificationService.addNotification({ title: 'Event', body: 'Data', type: 'pipeline_event' });

      expect(listener).toHaveBeenCalled();
      const notifs = listener.mock.calls[0][0];
      expect(notifs).toHaveLength(1);
      expect(notifs[0].title).toBe('Event');
    });
  });

  describe('fetchPreferences', () => {
    it('returns preferences from API', async () => {
      const prefs = [
        { id: 1, userId: 1, channel: 'email', eventType: 'fix_completed', enabled: true, channelTarget: 'test@test.com', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      ];
      mockRequest.mockResolvedValue({ preferences: prefs });

      const result = await notificationService.fetchPreferences();

      expect(mockRequest).toHaveBeenCalledWith('/v1/notifications/preferences');
      expect(result).toEqual(prefs);
    });

    it('returns empty array on API error', async () => {
      mockRequest.mockRejectedValue(new Error('fail'));

      const result = await notificationService.fetchPreferences();

      expect(result).toEqual([]);
    });
  });

  describe('upsertPreference', () => {
    it('sends correct data and returns preference', async () => {
      const pref = { id: 1, userId: 1, channel: 'slack', eventType: 'pipeline_failed', enabled: true, channelTarget: '#alerts', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' };
      mockRequest.mockResolvedValue({ preference: pref });

      const result = await notificationService.upsertPreference('slack', 'pipeline_failed', true, '#alerts');

      expect(mockRequest).toHaveBeenCalledWith('/v1/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ channel: 'slack', eventType: 'pipeline_failed', enabled: true, channelTarget: '#alerts' }),
      });
      expect(result).toEqual(pref);
    });

    it('sends preference without channelTarget', async () => {
      mockRequest.mockResolvedValue({ preference: { id: 2, userId: 1, channel: 'email', eventType: 'fix_completed', enabled: false, channelTarget: null, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' } });

      const result = await notificationService.upsertPreference('email', 'fix_completed', false);

      expect(mockRequest).toHaveBeenCalledWith('/v1/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ channel: 'email', eventType: 'fix_completed', enabled: false, channelTarget: undefined }),
      });
      expect(result).not.toBeNull();
    });

    it('returns null on API error', async () => {
      mockRequest.mockRejectedValue(new Error('fail'));

      const result = await notificationService.upsertPreference('email', 'fix_completed', true);

      expect(result).toBeNull();
    });
  });

  describe('simulatePipelineEvent', () => {
    it('creates a pipeline started notification', () => {
      notificationService.simulatePipelineEvent('started', 'run-123', 'owner/repo');
      const notif = notificationService.getNotifications()[0];
      expect(notif.title).toBe('Pipeline Started');
      expect(notif.body).toContain('run-123');
      expect(notif.body).toContain('owner/repo');
      expect(notif.type).toBe('pipeline_event');
    });

    it('creates a pipeline failed notification without repo', () => {
      notificationService.simulatePipelineEvent('failed', 'run-456');
      const notif = notificationService.getNotifications()[0];
      expect(notif.title).toBe('Pipeline Failed');
      expect(notif.body).not.toContain('undefined');
    });
  });
});
