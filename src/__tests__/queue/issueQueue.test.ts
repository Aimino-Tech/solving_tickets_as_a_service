/**
 * Placeholder: BullMQ issue queue has been removed (RabbitMQ-only now).
 * This file is intentionally empty. The issue queue is now handled by
 * the RabbitMQ adapter and consumer in src/queue/rabbitmq.ts.
 */

import { describe, it, expect } from 'vitest';

describe('issueQueue (removed - RabbitMQ only)', () => {
  it('is a no-op after BullMQ removal', async () => {
    expect(true).toBe(true);
  });
});
