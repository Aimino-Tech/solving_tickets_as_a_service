/**
 * AIM-4444 — Durable WorkPublisher backed by RabbitMQ.
 *
 * Long work handed from the chat session to the lead OS session is written to
 * RabbitMQ (durable) instead of being held in the pod, so it survives pod death
 * and gateway restart. The existing dispatch pipeline consumes the queue and
 * posts the final status back to the same Slack thread.
 *
 * Every hop carries the same traceId so thread + logs correlate end to end.
 */

import { publishMessage } from '../queue/rabbitmq.js';
import type { WorkItem, WorkPublisher } from './bridge.js';

export interface RmqWorkPublisherOptions {
  /** Queue to publish long-work items into. Defaults to the chat work queue. */
  queue?: string;
  exchange?: string;
  routingKey?: string;
}

export const CHAT_WORK_QUEUE = 'syntaro.chat.work';
export const CHAT_WORK_EXCHANGE = 'syntaro.direct';
export const CHAT_WORK_ROUTING_KEY = 'chat.work';

/**
 * Wraps `publishMessage`. Never throws on transient publish failure — reports
 * `accepted: false` so the bridge can fall back to the short-work path instead
 * of losing the instruction.
 */
export class RmqWorkPublisher implements WorkPublisher {
  private readonly queue: string;
  private readonly exchange: string;
  private readonly routingKey: string;

  constructor(opts: RmqWorkPublisherOptions = {}) {
    this.queue = opts.queue ?? CHAT_WORK_QUEUE;
    this.exchange = opts.exchange ?? CHAT_WORK_EXCHANGE;
    this.routingKey = opts.routingKey ?? CHAT_WORK_ROUTING_KEY;
  }

  async publish(item: WorkItem): Promise<{ accepted: boolean }> {
    try {
      const accepted = await publishMessage(this.exchange, this.routingKey, {
        kind: 'chat_work',
        traceId: item.traceId,
        instruction: item.instruction,
        threadTs: item.threadRef.threadTs,
        channelId: item.threadRef.channelId,
        userId: item.userId,
        memorySnapshot: item.memorySnapshot,
        publishedAt: new Date().toISOString(),
      });
      return { accepted };
    } catch {
      return { accepted: false };
    }
  }
}

export function createRmqWorkPublisher(opts?: RmqWorkPublisherOptions): RmqWorkPublisher {
  return new RmqWorkPublisher(opts);
}
