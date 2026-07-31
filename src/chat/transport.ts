/**
 * AIM-4442 — Pod dial-out transport abstraction.
 *
 * The pod dials OUT to the gateway (never the reverse): the gateway exposes no
 * public endpoint and the pod reconnects with exponential backoff. Both ends of
 * the transport speak the same small protocol:
 *
 *   pod   → gateway: { kind: 'register'|'heartbeat'|'unregister', userId, sessionId }
 *   pod   → gateway: { kind: 'pod_message', threadTs, channelId, userId, text, ts }
 *   gateway → pod:   { kind: 'dispatch', threadTs, channelId, sessionId, text }
 *
 * The in-memory implementation below is a linked pair used by tests and the
 * eval harness; a socket-mode adapter (outbound WebSocket) is the production
 * transport and is wired through the same interface.
 */

export interface PodToGatewayMessage {
  kind: 'register' | 'heartbeat' | 'unregister' | 'pod_message';
  userId: string;
  sessionId?: string;
  threadTs?: string;
  channelId?: string;
  text?: string;
  ts?: string;
}

export interface GatewayToPodMessage {
  kind: 'dispatch' | 'ack' | 'shutdown';
  threadTs: string;
  channelId?: string;
  sessionId: string;
  text: string;
}

export interface PodTransport {
  readonly name: string;
  onPodMessage(cb: (msg: PodToGatewayMessage) => void): void;
  onGatewayMessage(cb: (msg: GatewayToPodMessage) => void): void;
  sendToGateway(msg: PodToGatewayMessage): void;
  sendToPod(msg: GatewayToPodMessage): void;
  close(): void;
}

/** Linked in-memory transport pair (pod end + gateway end). */
export class InMemoryPodTransport implements PodTransport {
  readonly name = 'in-memory';
  private twin: InMemoryPodTransport | null = null;
  private onPodMsg: ((msg: PodToGatewayMessage) => void) | null = null;
  private onGatewayMsg: ((msg: GatewayToPodMessage) => void) | null = null;
  private closed = false;

  /** Build the two linked ends of an in-memory link. */
  static createPair(): { pod: InMemoryPodTransport; gateway: InMemoryPodTransport } {
    const pod = new InMemoryPodTransport();
    const gateway = new InMemoryPodTransport();
    pod.twin = gateway;
    gateway.twin = pod;
    return { pod, gateway };
  }

  /** Gateway end: register handler for messages coming from the pod. */
  onPodMessage(cb: (msg: PodToGatewayMessage) => void): void {
    this.onPodMsg = cb;
  }

  /** Pod end: register handler for messages coming from the gateway. */
  onGatewayMessage(cb: (msg: GatewayToPodMessage) => void): void {
    this.onGatewayMsg = cb;
  }

  /** Pod end sends to gateway end. */
  sendToGateway(msg: PodToGatewayMessage): void {
    if (this.closed || !this.twin) return;
    this.twin.onPodMsg?.(msg);
  }

  /** Gateway end sends to pod end. */
  sendToPod(msg: GatewayToPodMessage): void {
    if (this.closed || !this.twin) return;
    this.twin.onGatewayMsg?.(msg);
  }

  close(): void {
    this.closed = true;
    this.onPodMsg = null;
    this.onGatewayMsg = null;
  }
}

export function exponentialBackoffDelay(attempt: number, baseMs = 500, maxMs = 30_000): number {
  const exponent = 2 ** Math.min(attempt, 10);
  return Math.min(baseMs * exponent, maxMs);
}
