export interface AmqpConfig {
  url: string;
  exchange: string;
  retryExchange: string;
  dlqExchange: string;
  prefetch: number;
  heartbeat: number;
  reconnectDelayMs: number;
  maxReconnectAttempts: number;
}

export interface MessageEnvelope<T = unknown> {
  version: number;
  messageId: string;
  timestamp: string;
  source: string;
  type: string;
  correlationId?: string;
  replyTo?: string;
  payload: T;
}

export interface DeliveryInfo {
  exchange: string;
  routingKey: string;
  redelivered: boolean;
}

export type MessageHandler<T = unknown> = (
  message: MessageEnvelope<T>,
  delivery: DeliveryInfo,
  ack: () => Promise<void>,
  nack: (requeue?: boolean) => Promise<void>,
) => Promise<void>;

export interface BindingSpec {
  exchange: string;
  routingKeys: string[];
  queue: string;
}
