import type { Channel, ChannelModel } from "amqplib";
import amqplib from "amqplib";
import { EventEmitter } from "events";
import { config } from "../config.js";
import { rootLogger } from "../utils/logger.js";

const log = rootLogger.child({ module: "async-execution" });

export type ExecutionStatus =
  | "registered"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface ExecutionState {
  id: string;
  status: ExecutionStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionEvent {
  executionId: string;
  status: ExecutionStatus;
  result?: unknown;
  error?: string;
  timestamp: number;
}

const EXCHANGE_STATUS = "execution:status";
const EXCHANGE_RESULT = "execution:result";
const EXCHANGE_CANCEL = "execution:cancel";
const STATUS_PREFIX = "stas:execution:state:";
const TTL_COMPLETED_MS = 300_000;
const TTL_EXECUTION_MS = 600_000;

let _redisClient: import("ioredis").Redis | null = null;

function getRedis(): import("ioredis").Redis {
  if (!_redisClient) {
    const Redis = require("ioredis");
    _redisClient = new Redis(config.queue.redisUrl || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
  }
  return _redisClient as import("ioredis").Redis;
}

export class AsyncExecutionManager {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private emitter = new EventEmitter();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;
  private connectionAttempts = 0;
  private consumers: Set<string> = new Set();

  async connect(): Promise<void> {
    if (this.connection && this.channel) return;
    if (this.connecting) return;
    this.connecting = true;
    this.connectionAttempts++;

    try {
      const url = process.env.RABBITMQ_URL || "amqp://localhost:5672";
      const conn = await amqplib.connect(url);
      this.connection = conn;
      this.channel = await conn.createChannel();

      await this.channel.assertExchange(EXCHANGE_STATUS, "topic", { durable: true });
      await this.channel.assertExchange(EXCHANGE_RESULT, "topic", { durable: true });
      await this.channel.assertExchange(EXCHANGE_CANCEL, "topic", { durable: true });

      conn.on("close", () => {
        log.warn("RabbitMQ connection closed — scheduling reconnect");
        this.scheduleReconnect();
      });

      conn.on("error", (err: Error) => {
        log.error({ err: String(err) }, "RabbitMQ connection error");
      });

      this.connectionAttempts = 0;
      log.info("AsyncExecutionManager connected to RabbitMQ");
    } catch (err) {
      log.error({ err: String(err) }, "Failed to connect to RabbitMQ");
      this.scheduleReconnect();
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000);
    log.info({ delay, attempt: this.connectionAttempts }, "Scheduling RabbitMQ reconnect");
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.connection = null;
      this.channel = null;
      try {
        await this.connect();
      } catch {
        // reconnect will be retried
      }
    }, delay);
  }

  async registerExecution(
    executionId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const ch = await this.ensureChannel();
    const state: ExecutionState = {
      id: executionId,
      status: "registered",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata,
    };

    await this.persistState(executionId, state);

    ch.publish(
      EXCHANGE_STATUS,
      `execution.${executionId}.status`,
      Buffer.from(JSON.stringify({
        executionId,
        status: "registered",
        timestamp: Date.now(),
      }) as string),
      { persistent: true, expiration: TTL_EXECUTION_MS },
    );

    this.emitter.emit("execution:update", state);
    log.info({ executionId }, "Execution registered");
  }

  async updateStatus(
    executionId: string,
    status: ExecutionStatus,
    result?: unknown,
    error?: string,
  ): Promise<void> {
    const ch = await this.ensureChannel();

    if (status === "cancelled") {
      ch.publish(
        EXCHANGE_CANCEL,
        `execution.${executionId}.cancel`,
        Buffer.from(JSON.stringify({
          executionId,
          timestamp: Date.now(),
        })),
        { persistent: true },
      );
    }

    const update = {
      executionId,
      status,
      result,
      error,
      timestamp: Date.now(),
    };

    ch.publish(
      EXCHANGE_STATUS,
      `execution.${executionId}.status`,
      Buffer.from(JSON.stringify(update)),
      { persistent: true, expiration: TTL_EXECUTION_MS },
    );

    if (status === "completed" || status === "failed") {
      ch.publish(
        EXCHANGE_RESULT,
        `execution.${executionId}.result`,
        Buffer.from(JSON.stringify(update)),
        { persistent: true, expiration: TTL_COMPLETED_MS },
      );
    }

    const state = await this.getExecution(executionId);
    if (state) {
      state.status = status;
      state.updatedAt = Date.now();
      if (result !== undefined) state.result = result;
      if (error !== undefined) state.error = error;
      await this.persistState(executionId, state);
    }

    this.emitter.emit("execution:update", {
      id: executionId,
      status,
      result,
      error,
      updatedAt: Date.now(),
    } as ExecutionState);

    if (status === "completed") {
      this.emitter.emit("execution:complete", { executionId, result, timestamp: Date.now() });
    } else if (status === "failed") {
      this.emitter.emit("execution:failed", { executionId, error, timestamp: Date.now() });
    }

    log.info({ executionId, status }, "Execution status updated");
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(STATUS_PREFIX + executionId);
      if (!raw) return null;
      return JSON.parse(raw) as ExecutionState;
    } catch (err) {
      log.error({ err: String(err) }, "Failed to get execution from Redis");
      return null;
    }
  }

  waitForStatus(
    executionId: string,
    targetStatus: ExecutionStatus,
    timeoutMs: number = 300_000,
  ): Promise<ExecutionEvent> {
    return new Promise((resolve, reject) => {
      let consumerTag: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = async () => {
        if (timer) clearTimeout(timer);
        if (consumerTag && this.channel) {
          try {
            await this.channel.cancel(consumerTag);
            this.consumers.delete(consumerTag);
          } catch {
            // ignore
          }
        }
      };

      timer = setTimeout(async () => {
        await cleanup();
        reject(new Error(`waitForStatus timed out after ${timeoutMs}ms for ${executionId}`));
      }, timeoutMs);

      this.subscribeToStatus(executionId, async (event) => {
        if (event.status === targetStatus) {
          await cleanup();
          resolve(event);
        }
      }).then((tag) => {
        if (tag) consumerTag = tag;
      }).catch((err) => {
        reject(err);
      });
    });
  }

  waitForResult(
    executionId: string,
    timeoutMs: number = 300_000,
  ): Promise<ExecutionEvent> {
    return new Promise((resolve, reject) => {
      let consumerTag: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = async () => {
        if (timer) clearTimeout(timer);
        if (consumerTag && this.channel) {
          try {
            await this.channel.cancel(consumerTag);
            this.consumers.delete(consumerTag);
          } catch {
            // ignore
          }
        }
      };

      timer = setTimeout(async () => {
        await cleanup();
        reject(new Error(`waitForResult timed out after ${timeoutMs}ms for ${executionId}`));
      }, timeoutMs);

      this.subscribeToResult(executionId, async (event) => {
        await cleanup();
        resolve(event);
      }).then((tag) => {
        if (tag) consumerTag = tag;
      }).catch((err) => {
        reject(err);
      });
    });
  }

  async cancelExecution(executionId: string): Promise<void> {
    const ch = await this.ensureChannel();

    ch.publish(
      EXCHANGE_CANCEL,
      `execution.${executionId}.cancel`,
      Buffer.from(JSON.stringify({
        executionId,
        timestamp: Date.now(),
      })),
      { persistent: true },
    );

    const state = await this.getExecution(executionId);
    if (state) {
      state.status = "cancelled";
      state.updatedAt = Date.now();
      await this.persistState(executionId, state);
    }

    this.emitter.emit("execution:update", {
      id: executionId,
      status: "cancelled",
      updatedAt: Date.now(),
    } as ExecutionState);

    log.info({ executionId }, "Execution cancelled");
  }

  onUpdate(handler: (state: ExecutionState) => void): void {
    this.emitter.on("execution:update", handler);
  }

  onComplete(handler: (event: ExecutionEvent) => void): void {
    this.emitter.on("execution:complete", handler);
  }

  onFailed(handler: (event: ExecutionEvent) => void): void {
    this.emitter.on("execution:failed", handler);
  }

  offUpdate(handler: (state: ExecutionState) => void): void {
    this.emitter.off("execution:update", handler);
  }

  offComplete(handler: (event: ExecutionEvent) => void): void {
    this.emitter.off("execution:complete", handler);
  }

  offFailed(handler: (event: ExecutionEvent) => void): void {
    this.emitter.off("execution:failed", handler);
  }

  private async persistState(executionId: string, state: ExecutionState): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(
        STATUS_PREFIX + executionId,
        JSON.stringify(state),
        "PX",
        TTL_EXECUTION_MS,
      );
    } catch (err) {
      log.error({ err: String(err) }, "Failed to persist execution state to Redis");
    }
  }

  private async subscribeToStatus(
    executionId: string,
    handler: (event: ExecutionEvent) => void,
  ): Promise<string | null> {
    const ch = await this.ensureChannel();
    const { queue } = await ch.assertQueue("", { exclusive: true, autoDelete: true });
    await ch.bindQueue(queue, EXCHANGE_STATUS, `execution.${executionId}.status`);

    const { consumerTag } = await ch.consume(queue, (msg) => {
      if (!msg) return;
      try {
        const event = JSON.parse(msg.content.toString()) as ExecutionEvent;
        handler(event);
      } catch (err) {
        log.error({ err: String(err) }, "Failed to parse status event");
      } finally {
        ch.ack(msg);
      }
    });

    this.consumers.add(consumerTag);
    return consumerTag;
  }

  private async subscribeToResult(
    executionId: string,
    handler: (event: ExecutionEvent) => void,
  ): Promise<string | null> {
    const ch = await this.ensureChannel();
    const { queue } = await ch.assertQueue("", { exclusive: true, autoDelete: true });
    await ch.bindQueue(queue, EXCHANGE_RESULT, `execution.${executionId}.result`);

    const { consumerTag } = await ch.consume(queue, (msg) => {
      if (!msg) return;
      try {
        const event = JSON.parse(msg.content.toString()) as ExecutionEvent;
        handler(event);
      } catch (err) {
        log.error({ err: String(err) }, "Failed to parse result event");
      } finally {
        ch.ack(msg);
      }
    });

    this.consumers.add(consumerTag);
    return consumerTag;
  }

  private async ensureChannel(): Promise<Channel> {
    if (this.channel) return this.channel;
    await this.connect();
    if (!this.channel) throw new Error("Failed to establish RabbitMQ channel");
    return this.channel;
  }

  async shutdown(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const tag of this.consumers) {
      try {
        await this.channel?.cancel(tag);
      } catch {
        // ignore
      }
    }
    this.consumers.clear();

    try {
      await this.channel?.close();
    } catch {
      // ignore
    }
    try {
      const conn = this.connection;
      if (conn) {
        await conn.close();
      }
    } catch {
      // ignore
    }

    this.channel = null;
    this.connection = null;
  }
}

let _instance: AsyncExecutionManager | null = null;

export function getAsyncExecutionManager(): AsyncExecutionManager {
  if (!_instance) {
    _instance = new AsyncExecutionManager();
  }
  return _instance;
}
