export { AmqpConnection } from './connection.js';
export { declareExchanges, declareRetryQueues, declareDlq, EXCHANGE_DIRECT, EXCHANGE_RETRY, EXCHANGE_DLQ, EXCHANGE_PHASE, QUEUE_PIPELINE, QUEUE_DLQ, QUEUE_PHASE_PREFIX, QUEUE_RETRY_PREFIX, RETRY_DELAYS_MS } from './exchanges.js';
export { publishWithConfirms, publishToPipeline, publishToPhase, publishToDlq, createMessageEnvelope } from './producer.js';
export { startConsumer, startDlqConsumer } from './consumer.js';
export { scheduleRetry, scheduleDlq, getInitialRetryDelay } from './retry.js';
export type { AmqpConfig, MessageEnvelope, DeliveryInfo, MessageHandler, BindingSpec } from './types.js';
