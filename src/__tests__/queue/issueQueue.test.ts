/**
 * Placeholder: BullMQ issue queue has been removed (RabbitMQ-only now).
 * This file is intentionally empty. The issue queue is now handled by
 * the RabbitMQ adapter and consumer in src/queue/rabbitmq.ts.
 */

import { describe, it, expect } from 'vitest';
import { isConnected, setConnected } from '../../queue/rabbitmq.js';

describe('issueQueue (removed - RabbitMQ only)', () => {
  it('delegates queue state to the RabbitMQ adapter after BullMQ removal', () => {
    expect(setConnected).toBeTypeOf('function');
    expect(isConnected).toBeTypeOf('function');
    setConnected(false);
    expect(isConnected()).toBe(false);
  });
});
