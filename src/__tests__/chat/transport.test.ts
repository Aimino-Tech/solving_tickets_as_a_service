import { describe, it, expect } from 'vitest';
import { InMemoryPodTransport, exponentialBackoffDelay } from '../../chat/transport.js';

describe('in-memory pod transport (AIM-4442)', () => {
  it('createPair links pod and gateway ends', () => {
    const { pod, gateway } = InMemoryPodTransport.createPair();
    const received: string[] = [];
    gateway.onPodMessage((msg) => received.push(msg.kind));
    pod.sendToGateway({ kind: 'register', userId: 'u1' });
    expect(received).toEqual(['register']);
  });

  it('gateway can send dispatches to the pod', () => {
    const { pod, gateway } = InMemoryPodTransport.createPair();
    const received: string[] = [];
    pod.onGatewayMessage((msg) => received.push(msg.kind));
    gateway.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'hi' });
    expect(received).toEqual(['dispatch']);
  });

  it('close stops delivery in both directions', () => {
    const { pod, gateway } = InMemoryPodTransport.createPair();
    const received: string[] = [];
    gateway.onPodMessage((msg) => received.push(msg.kind));
    pod.close();
    pod.sendToGateway({ kind: 'heartbeat', userId: 'u1' });
    expect(received).toEqual([]);
  });

  it('exponentialBackoffDelay grows with attempt and caps at max', () => {
    expect(exponentialBackoffDelay(0, 500, 30_000)).toBe(500);
    expect(exponentialBackoffDelay(1, 500, 30_000)).toBe(1000);
    expect(exponentialBackoffDelay(6, 500, 30_000)).toBe(30_000);
    expect(exponentialBackoffDelay(20, 500, 30_000)).toBe(30_000);
  });
});
