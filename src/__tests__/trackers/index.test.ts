/**
 * Unit tests for src/trackers/index.ts — Tracker registry.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockLinearTracker = { source: 'linear', getTicket: vi.fn(), postComment: vi.fn(), updateStatus: vi.fn(), createLink: vi.fn() };
const mockJiraTracker = { source: 'jira', getTicket: vi.fn(), postComment: vi.fn(), updateStatus: vi.fn(), createLink: vi.fn() };

vi.mock('../../trackers/linear.js', () => ({ LinearTracker: vi.fn(function () { return mockLinearTracker; }) }));
vi.mock('../../trackers/jira.js', () => ({ JiraTracker: vi.fn(function () { return mockJiraTracker; }) }));

vi.mock('../../config.js', () => ({
  config: {
    trackers: {
      linear: { apiKey: 'lin-key' },
      jira: { url: 'https://jira.example.com', email: 'test@test.com', apiToken: 'token' },
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('trackers/index', () => {
  let trackers: typeof import('../../trackers/index.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    trackers = await import('../../trackers/index.js');
  });

  describe('getTracker', () => {
    it('returns undefined for uninitialized tracker', () => {
      expect(trackers.getTracker('linear')).toBeUndefined();
    });
  });

  describe('initTrackers', () => {
    it('initializes both trackers when configured', () => {
      trackers.initTrackers();
      expect(trackers.getTracker('linear')).toBeDefined();
      expect(trackers.getTracker('jira')).toBeDefined();
    });

    it('returns all registered trackers', () => {
      trackers.initTrackers();
      const all = trackers.getAllTrackers();
      expect(all.length).toBe(2);
    });

    it('checks tracker presence', () => {
      trackers.initTrackers();
      expect(trackers.hasTracker('linear')).toBe(true);
      expect(trackers.hasTracker('jira')).toBe(true);
    });
  });
});
