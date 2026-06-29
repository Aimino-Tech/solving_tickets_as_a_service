import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { isConnected, connect, disconnect } from './rabbitmq.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'rabbitmq-heartbeat' });

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_GRACE_MS = 5_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastHealthyTime = Date.now();

export function startHeartbeat(): void {
  if (heartbeatTimer) {
    log.warn('Heartbeat monitor already running');
    return;
  }

  log.info({ intervalMs: HEARTBEAT_INTERVAL_MS }, 'Starting RabbitMQ heartbeat monitor');

  heartbeatTimer = setInterval(async () => {
    try {
      await checkHeartbeat();
    } catch (err) {
      log.error({ err: String(err) }, 'Heartbeat check failed');
    }
  }, HEARTBEAT_INTERVAL_MS);

  checkHeartbeat().catch((err) => log.warn({ err: String(err) }, 'Initial heartbeat check failed'));
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    log.info('RabbitMQ heartbeat monitor stopped');
  }
}

async function checkHeartbeat(): Promise<void> {
  const connected = isConnected();
  const now = Date.now();

  bridgeMetrics.setGauge('rabbitmq_connected', {}, connected ? 1 : 0);

  if (connected) {
    lastHealthyTime = now;
    return;
  }

  const timeSinceHealthy = now - lastHealthyTime;
  if (timeSinceHealthy < RECONNECT_GRACE_MS) {
    return;
  }

  log.warn(
    { timeSinceHealthyMs: timeSinceHealthy },
    'RabbitMQ not connected — attempting reconnection',
  );

  try {
    await disconnect();
    await connect();
    log.info('RabbitMQ reconnection successful');
    lastHealthyTime = Date.now();
  } catch (err) {
    log.error({ err: String(err) }, 'RabbitMQ reconnection failed');
  }
}

export function getHeartbeatStatus(): { healthy: boolean; connected: boolean; lastHealthy: string; uptimeMs: number } {
  const now = Date.now();
  return {
    healthy: isConnected(),
    connected: isConnected(),
    lastHealthy: new Date(lastHealthyTime).toISOString(),
    uptimeMs: now - lastHealthyTime,
  };
}
