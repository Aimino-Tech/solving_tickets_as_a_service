/**
 * Unit tests for src/tracker/linearWebhookHandler.ts — Linear webhook handler.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../config.js', () => ({
  config: {
    trackers: {
      linear: {
        apiKey: 'lin_api_key',
        webhookSecret: 'whsec_test',
      },
      defaultRepoOwner: 'test-owner',
      defaultRepoName: 'test-repo',
      installationId: 123,
    },
    syntaro: {
      label: 'syntaro:fix',
    },
  },
}));

// Mock the RabbitMQ module
const mockPublishMessage = vi.fn().mockResolvedValue(true);
vi.mock('../../queue/rabbitmq.js', () => ({
  QUEUES: { issuesFix: { name: 'syntaro.issues.fix', exchange: 'syntaro.direct', routingKey: 'issue.fix' } },
  publishMessage: mockPublishMessage,
  connect: vi.fn().mockResolvedValue(undefined),
  isConnected: vi.fn().mockReturnValue(true),
}));

// Mock the tracker
const mockGetTicket = vi.fn();
const mockGetTracker = vi.fn();
vi.mock('../../trackers/linear.js', () => ({
  LinearTracker: vi.fn(function () {
    return {
      source: 'linear',
      getTicket: mockGetTicket,
      postComment: vi.fn(),
      updateStatus: vi.fn(),
      createLink: vi.fn(),
    };
  }),
  verifyLinearWebhookSignature: vi.fn(),
}));

vi.mock('../../trackers/index.js', () => ({
  getTracker: (...args: unknown[]) => mockGetTracker(...args),
}));

// Mock webhook logging
vi.mock('../../webhooks/eventLogger.js', () => ({
  logWebhookReceived: vi.fn().mockResolvedValue(1),
  logWebhookProcessed: vi.fn(),
  logWebhookFailed: vi.fn(),
}));

vi.mock('../../webhooks/metrics.js', () => ({
  recordWebhookDuration: vi.fn(),
  recordWebhookReceived: vi.fn(),
}));

describe('tracker/linearWebhookHandler', () => {
  let handler: typeof import('../../tracker/linearWebhookHandler.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetTracker.mockReturnValue({
      source: 'linear',
      getTicket: mockGetTicket,
      postComment: vi.fn(),
      updateStatus: vi.fn(),
      createLink: vi.fn(),
    });
    handler = await import('../../tracker/linearWebhookHandler.js');
  });

  describe('extractWebhookContext', () => {
    it('extracts context from a valid create payload', () => {
      const payload = {
        action: 'create',
        data: { id: 'lin_123', title: 'Test Issue' },
      };

      const context = handler.extractWebhookContext(payload);
      expect(context).not.toBeNull();
      expect(context!.ticketId).toBe('lin_123');
      expect(context!.action).toBe('create');
    });

    it('extracts context from an update payload', () => {
      const payload = {
        action: 'update',
        data: { id: 'lin_456' },
      };

      const context = handler.extractWebhookContext(payload);
      expect(context).not.toBeNull();
      expect(context!.ticketId).toBe('lin_456');
      expect(context!.action).toBe('update');
    });

    it('returns null when payload is missing data.id', () => {
      const payload = { action: 'create', data: {} };
      const context = handler.extractWebhookContext(payload);
      expect(context).toBeNull();
    });

    it('returns null when data is missing entirely', () => {
      const payload = { action: 'create' };
      const context = handler.extractWebhookContext(payload);
      expect(context).toBeNull();
    });

    it('defaults action to "update" when not provided', () => {
      const payload = { data: { id: 'lin_789' } };
      const context = handler.extractWebhookContext(payload);
      expect(context).not.toBeNull();
      expect(context!.ticketId).toBe('lin_789');
      expect(context!.action).toBe('update');
    });
  });

  describe('getIssueContext', () => {
    it('fetches and returns issue context', async () => {
      mockGetTicket.mockResolvedValue({
        id: 'lin_123',
        title: 'Test Issue',
        description: 'A test issue description',
        status: 'In Progress',
        priority: 2,
        url: 'https://linear.app/team/issue/LIN-123',
        source: 'linear',
        labels: ['bug', 'syntaro:fix'],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      });

      const context = await handler.getIssueContext('lin_123');
      expect(context).not.toBeNull();
      expect(context!.ticketId).toBe('lin_123');
      expect(context!.title).toBe('Test Issue');
      expect(context!.status).toBe('In Progress');
      expect(context!.labels).toContain('syntaro:fix');
    });

    it('returns null when tracker is not available', async () => {
      mockGetTracker.mockReturnValue(undefined);
      // Re-import to pick up the new mock
      const h = await import('../../tracker/linearWebhookHandler.js');
      const context = await h.getIssueContext('lin_123');
      expect(context).toBeNull();
    });

    it('returns null when getTicket throws', async () => {
      mockGetTicket.mockRejectedValue(new Error('API error'));
      const context = await handler.getIssueContext('lin_999');
      expect(context).toBeNull();
    });
  });

  describe('LinearWebhookRouter', () => {
    it('exports a router', () => {
      expect(handler.linearWebhookRouter).toBeDefined();
      expect(typeof handler.linearWebhookRouter).toBe('function');
    });

    it('re-exports verifyLinearWebhookSignature', () => {
      expect(handler.verifyLinearWebhookSignature).toBeDefined();
      expect(typeof handler.verifyLinearWebhookSignature).toBe('function');
    });

    it('re-exports LinearTracker', () => {
      expect(handler.LinearTracker).toBeDefined();
    });
  });
});
