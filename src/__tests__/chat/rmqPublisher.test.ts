import { describe, expect, it, vi } from 'vitest';

const publishMessageMock = vi.fn();
vi.mock('../../queue/rabbitmq.js', () => ({
  publishMessage: (...args: unknown[]) => publishMessageMock(...args),
}));

import type { WorkItem } from '../../chat/bridge.js';
import {
  CHAT_WORK_EXCHANGE,
  CHAT_WORK_QUEUE,
  CHAT_WORK_ROUTING_KEY,
  createRmqWorkPublisher,
  RmqWorkPublisher,
} from '../../chat/rmqPublisher.js';

const item: WorkItem = {
  traceId: 'tr_abc_123456',
  instruction: 'fix the flaky test',
  threadRef: { threadTs: '1712345678.000001', channelId: 'C123' },
  userId: 'U123',
  memorySnapshot: { facts: [], decisions: [], plan: null, preferences: {}, updatedAt: '' },
};

describe('RmqWorkPublisher', () => {
  afterEach(() => publishMessageMock.mockReset());
  it('publishes the work item with traceId and thread context', async () => {
    publishMessageMock.mockResolvedValue(true);
    const publisher = new RmqWorkPublisher();
    const result = await publisher.publish(item);

    expect(result.accepted).toBe(true);
    expect(publishMessageMock).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, content] = publishMessageMock.mock.calls[0] as [string, string, any];
    expect(exchange).toBe(CHAT_WORK_EXCHANGE);
    expect(routingKey).toBe(CHAT_WORK_ROUTING_KEY);
    expect(content.kind).toBe('chat_work');
    expect(content.traceId).toBe('tr_abc_123456');
    expect(content.instruction).toBe('fix the flaky test');
    expect(content.threadTs).toBe('1712345678.000001');
    expect(content.channelId).toBe('C123');
    expect(content.userId).toBe('U123');
    expect(content.memorySnapshot).toEqual(item.memorySnapshot);
  });

  it('reports accepted=false when publish fails', async () => {
    publishMessageMock.mockImplementation(async () => {
      throw new Error('connection lost');
    });
    const publisher = new RmqWorkPublisher();
    const result = await publisher.publish(item);
    expect(result.accepted).toBe(false);
  });

  it('honours custom queue/exchange/routingKey options', async () => {
    publishMessageMock.mockResolvedValue(true);
    const publisher = new RmqWorkPublisher({ queue: 'q.custom', exchange: 'ex.custom', routingKey: 'rk.custom' });
    await publisher.publish(item);
    const [exchange, routingKey] = publishMessageMock.mock.calls[0] as [string, string];
    expect(exchange).toBe('ex.custom');
    expect(routingKey).toBe('rk.custom');
    expect(CHAT_WORK_QUEUE).toBe('syntaro.chat.work');
  });

  it('factory creates an RmqWorkPublisher', () => {
    expect(createRmqWorkPublisher()).toBeInstanceOf(RmqWorkPublisher);
  });
});
