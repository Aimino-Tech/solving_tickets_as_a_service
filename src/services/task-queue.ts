import amqplib, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { rootLogger } from "../utils/logger.js";

const log = rootLogger.child({ module: "task-queue" });

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface PendingTask {
  id: string;
  type: string;
  payload: unknown;
  priority: number;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskUpdateEvent {
  taskId: string;
  type: string;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  timestamp: number;
}

const QUEUE_PREFIX = "stas.tasks";
const DLX_SUFFIX = ".dlx";
const DLQ_SUFFIX = ".dlq";
const MAX_RETRIES_DEFAULT = 3;

export class TaskQueue {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private emitter = new EventEmitter();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private consumers: Map<string, string> = new Map();
  private activeTasks = new Set<string>();
  private concurrencyLimits: Map<string, number> = new Map();
  private taskQueues: Map<string, string[]> = new Map();

  async connect(): Promise<void> {
    if (this.connection && this.channel) return;
    try {
      const url = process.env.RABBITMQ_URL || "amqp://localhost:5672";
      const conn = await amqplib.connect(url);
      this.connection = conn;
      this.channel = await conn.createChannel();

      await this.channel.prefetch(1);

      conn.on("close", () => {
        log.warn("TaskQueue connection closed — scheduling reconnect");
        this.scheduleReconnect();
      });

      conn.on("error", (err: Error) => {
        log.error({ err: String(err) }, "TaskQueue connection error");
      });

      log.info("TaskQueue connected to RabbitMQ");
    } catch (err) {
      log.error({ err: String(err) }, "Failed to connect TaskQueue");
      this.scheduleReconnect();
      throw err;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.connection = null;
      this.channel = null;
      this.consumers.clear();
      try {
        await this.connect();
      } catch {
        // retry in next cycle
      }
    }, 5000);
  }

  async addTask(
    type: string,
    payload: unknown,
    options?: {
      priority?: number;
      maxRetries?: number;
      taskId?: string;
    },
  ): Promise<string> {
    const ch = await this.ensureChannel();
    const taskId = options?.taskId || randomUUID();

    const queueName = `${QUEUE_PREFIX}.${type}`;
    const dlxName = queueName + DLX_SUFFIX;
    const dlqName = queueName + DLQ_SUFFIX;

    await ch.assertQueue(queueName, {
      durable: true,
      maxPriority: 10,
      deadLetterExchange: dlxName,
    });

    await ch.assertExchange(dlxName, "direct", { durable: true });
    await ch.assertQueue(dlqName, { durable: true });
    await ch.bindQueue(dlqName, dlxName, type);

    const task: PendingTask = {
      id: taskId,
      type,
      payload,
      priority: options?.priority ?? 5,
      status: "pending",
      retryCount: 0,
      maxRetries: options?.maxRetries ?? MAX_RETRIES_DEFAULT,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    ch.sendToQueue(queueName, Buffer.from(JSON.stringify(task)), {
      persistent: true,
      priority: task.priority,
      headers: {
        "x-task-id": taskId,
        "x-task-type": type,
        "x-retry-count": 0,
        "x-max-retries": task.maxRetries,
      },
    });

    log.info(
      { taskId, type, priority: task.priority, queue: queueName },
      "Task added to queue",
    );

    this.emitUpdate({
      taskId,
      type,
      status: "pending",
      timestamp: Date.now(),
    });

    return taskId;
  }

  async startConsumer(
    type: string,
    handler: (task: PendingTask) => Promise<unknown>,
    options?: {
      concurrency?: number;
    },
  ): Promise<void> {
    const ch = await this.ensureChannel();
    const queueName = `${QUEUE_PREFIX}.${type}`;
    const concurrency = options?.concurrency ?? 5;

    this.concurrencyLimits.set(type, concurrency);
    if (!this.taskQueues.has(type)) {
      this.taskQueues.set(type, []);
    }

    await ch.assertQueue(queueName, {
      durable: true,
      maxPriority: 10,
    });

    if (this.consumers.has(type)) {
      log.warn({ type }, "Consumer already exists for this task type");
      return;
    }

    const { consumerTag } = await ch.consume(
      queueName,
      async (msg) => {
        if (!msg) return;
        await this.processMessage(type, msg, handler);
      },
      { noAck: false },
    );

    this.consumers.set(type, consumerTag);

    log.info(
      { type, queue: queueName, concurrency, consumerTag },
      "Task consumer started",
    );
  }

  private async processMessage(
    type: string,
    msg: ConsumeMessage,
    handler: (task: PendingTask) => Promise<unknown>,
  ): Promise<void> {
    const ch = this.channel;
    if (!ch) return;

    const activeForType = this.activeTasks.size;
    const maxConcurrent = this.concurrencyLimits.get(type) ?? 5;

    if (activeForType >= maxConcurrent) {
      ch.nack(msg, false, true);
      return;
    }

    let task: PendingTask;
    try {
      task = JSON.parse(msg.content.toString()) as PendingTask;
    } catch {
      ch.nack(msg, false, false);
      return;
    }

    this.activeTasks.add(task.id);

    try {
      task.status = "running";
      task.updatedAt = Date.now();
      this.emitUpdate({
        taskId: task.id,
        type,
        status: "running",
        timestamp: Date.now(),
      });

      const result = await handler(task);

      task.status = "completed";
      task.result = result;
      task.updatedAt = Date.now();
      ch.ack(msg);

      this.emitUpdate({
        taskId: task.id,
        type,
        status: "completed",
        result,
        timestamp: Date.now(),
      });

      log.info({ taskId: task.id, type }, "Task completed");
    } catch (err) {
      task.retryCount++;
      task.updatedAt = Date.now();
      const errorStr = String(err);

      if (task.retryCount <= task.maxRetries) {
        ch.nack(msg, false, true);

        task.status = "pending";
        this.emitUpdate({
          taskId: task.id,
          type,
          status: "pending",
          error: errorStr,
          timestamp: Date.now(),
        });

        log.warn(
          { taskId: task.id, type, retryCount: task.retryCount, maxRetries: task.maxRetries },
          "Task will be retried",
        );
      } else {
        ch.nack(msg, false, false);

        const dlqName = `${QUEUE_PREFIX}.${type}${DLQ_SUFFIX}`;
        ch.sendToQueue(dlqName, msg.content, {
          persistent: true,
          headers: {
            "x-error": errorStr,
            "x-retry-count": task.retryCount,
          },
        });

        task.status = "failed";
        task.error = errorStr;

        this.emitUpdate({
          taskId: task.id,
          type,
          status: "failed",
          error: errorStr,
          timestamp: Date.now(),
        });

        log.error(
          { taskId: task.id, type, error: errorStr },
          "Task moved to DLQ after max retries",
        );
      }
    } finally {
      this.activeTasks.delete(task.id);
    }
  }

  async stopConsumer(type: string): Promise<void> {
    const consumerTag = this.consumers.get(type);
    if (!consumerTag || !this.channel) return;

    try {
      await this.channel.cancel(consumerTag);
    } catch {
      // ignore
    }
    this.consumers.delete(type);
    log.info({ type }, "Consumer stopped");
  }

  async getQueueStatus(type: string): Promise<{
    pending: number;
    active: number;
    consumerTag?: string;
  }> {
    const ch = await this.ensureChannel();
    const queueName = `${QUEUE_PREFIX}.${type}`;

    try {
      const { messageCount, consumerCount } = await ch.checkQueue(queueName);
      return {
        pending: messageCount,
        active: this.activeTasks.size,
        consumerTag: this.consumers.get(type),
      };
    } catch {
      return { pending: 0, active: 0 };
    }
  }

  onUpdate(handler: (event: TaskUpdateEvent) => void): void {
    this.emitter.on("task:update", handler);
  }

  offUpdate(handler: (event: TaskUpdateEvent) => void): void {
    this.emitter.off("task:update", handler);
  }

  private emitUpdate(event: TaskUpdateEvent): void {
    this.emitter.emit("task:update", event);
  }

  private async ensureChannel(): Promise<Channel> {
    if (this.channel) return this.channel;
    await this.connect();
    if (!this.channel) throw new Error("TaskQueue not connected");
    return this.channel;
  }

  async shutdown(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const [type, tag] of this.consumers) {
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

let _instance: TaskQueue | null = null;

export function getTaskQueue(): TaskQueue {
  if (!_instance) {
    _instance = new TaskQueue();
  }
  return _instance;
}
