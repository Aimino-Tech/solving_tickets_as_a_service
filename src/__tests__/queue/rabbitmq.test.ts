import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EXCHANGES, QUEUES, isConnected } from '../../queue/rabbitmq.js';

vi.mock('amqplib', () => ({
  connect: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  config: {
    rabbitmq: {
      url: 'amqp://localhost:5672/stas',
      prefetchCount: 10,
      reconnectDelayMs: 5000,
      maxReconnectAttempts: 10,
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

describe('RabbitMQ connection manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('exports expected exchange definitions', () => {
    expect(EXCHANGES.issues.name).toBe('stas.issues');
    expect(EXCHANGES.issues.type).toBe('topic');
    expect(EXCHANGES.agents.name).toBe('stas.agents');
    expect(EXCHANGES.agents.type).toBe('direct');
    expect(EXCHANGES.events.name).toBe('stas.events');
    expect(EXCHANGES.dlx.name).toBe('stas.dlx');
  });

  it('exports expected queue definitions', () => {
    expect(QUEUES.issuesFix.name).toBe('stas.issues.fix');
    expect(QUEUES.triage.name).toBe('stas.agents.triage');
    expect(QUEUES.opencode.name).toBe('stas.agents.opencode');
    expect(QUEUES.sandbox.name).toBe('stas.agents.sandbox');
    expect(QUEUES.verification.name).toBe('stas.agents.verification');
    expect(QUEUES.notifications.name).toBe('stas.events.notifications');
    expect(QUEUES.audit.name).toBe('stas.events.audit');
  });

  it('returns false for isConnected when not connected', () => {
    expect(isConnected()).toBe(false);
  });
});
