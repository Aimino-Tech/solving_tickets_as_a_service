import { describe, expect, it } from 'vitest';
import type { GatewayToPodMessage, PodToGatewayMessage } from '../../chat/transport.js';
import { exponentialBackoffDelay, InMemoryPodTransport } from '../../chat/transport.js';

describe('InMemoryPodTransport', () => {
  it('links the pod and gateway ends of a created pair', () => {
    const { pod, gateway } = InMemoryPodTransport.createPair();
    const received: PodToGatewayMessage[] = [];
    gateway.onPodMessage((msg) => received.push(msg));

    pod.sendToGateway({ kind: 'register', userId: 'u1', sessionId: 's1' });

    expect(received).toEqual([{ kind: 'register', userId: 'u1', sessionId: 's1' }]);
  });

  it('routes gateway messages to the pod end', () => {
    const { pod, gateway } = InMemoryPodTransport.createPair();
    const received: GatewayToPodMessage[] = [];
    pod.onGatewayMessage((msg) => received.push(msg));

    gateway.sendToPod({
      kind: 'dispatch',
      threadTs: 't1',
      sessionId: 's1',
      text: 'hello',
    });

    expect(received).toEqual([{ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'hello' }]);
  });

  it('stops sending once the sending end is closed', () => {
    const { pod, gateway } = InMemoryPodTransport.createPair();
    const received: PodToGatewayMessage[] = [];
    gateway.onPodMessage((msg) => received.push(msg));

    pod.close();
    pod.sendToGateway({ kind: 'heartbeat', userId: 'u1' });

    expect(received).toEqual([]);
  });

  it('stops sending once the receiving end is closed', () => {
    const { pod, gateway } = InMemoryPodTransport.createPair();
    const received: GatewayToPodMessage[] = [];
    pod.onGatewayMessage((msg) => received.push(msg));

    gateway.close();
    gateway.sendToPod({
      kind: 'dispatch',
      threadTs: 't1',
      sessionId: 's1',
      text: 'ignored',
    });

    expect(received).toEqual([]);
  });
});

describe('exponentialBackoffDelay', () => {
  it('grows by a factor of two from the base', () => {
    expect(exponentialBackoffDelay(0)).toBe(500);
    expect(exponentialBackoffDelay(1)).toBe(1000);
    expect(exponentialBackoffDelay(2)).toBe(2000);
  });

  it('caps at the maximum delay', () => {
    expect(exponentialBackoffDelay(6)).toBe(30000);
    expect(exponentialBackoffDelay(20)).toBe(30000);
  });

  it('honours custom base and max', () => {
    expect(exponentialBackoffDelay(0, 100, 5000)).toBe(100);
    expect(exponentialBackoffDelay(3, 100, 5000)).toBe(800);
    expect(exponentialBackoffDelay(10, 100, 5000)).toBe(5000);
  });
});
