import amqplib, { type Channel, type ChannelModel } from "amqplib";
import { randomUUID } from "crypto";
import { rootLogger } from "../utils/logger.js";

const log = rootLogger.child({ module: "celery-bridge" });

export interface CeleryTaskOptions {
  taskName: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
  queue?: string;
  routingKey?: string;
  expires?: number;
  softTimeLimit?: number;
  hardTimeLimit?: number;
}

export interface CeleryTaskResult {
  taskId: string;
  status: "PENDING" | "RUNNING" | "PROGRESS" | "SUCCESS" | "FAILURE" | "REVOKED";
  result?: unknown;
  traceback?: string;
  meta?: Record<string, unknown>;
}

export class CeleryBridge {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;

  async connect(): Promise<void> {
    if (this.connection && this.channel) return;
    if (this.connecting) return;
    this.connecting = true;

    try {
      const url = process.env.CELERY_BROKER_URL || "amqp://localhost:5672";
      const conn = await amqplib.connect(url);
      this.connection = conn;
      this.channel = await conn.createChannel();

      conn.on("close", () => {
        log.warn("Celery bridge connection closed — scheduling reconnect");
        this.scheduleReconnect();
      });

      conn.on("error", (err: Error) => {
        log.error({ err: String(err) }, "Celery bridge connection error");
      });

      log.info("Celery bridge connected to RabbitMQ");
    } catch (err) {
      log.error({ err: String(err) }, "Failed to connect Celery bridge");
      this.scheduleReconnect();
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.connection = null;
      this.channel = null;
      try {
        await this.connect();
      } catch {
        // retry in next cycle
      }
    }, 5000);
  }

  async sendTask(options: CeleryTaskOptions): Promise<string> {
    const ch = await this.ensureChannel();
    const taskId = options.taskName.includes(".")
      ? `${options.taskName}.${randomUUID()}`
      : randomUUID();

    const exchange = "celery";
    const routingKey = options.routingKey || "celery";
    const queue = options.queue || "celery";

    await ch.assertExchange(exchange, "direct", { durable: true });
    await ch.assertQueue(queue, { durable: true });
    await ch.bindQueue(queue, exchange, routingKey);

    const messageProperties: Record<string, unknown> = {
      task: options.taskName,
      id: taskId,
      args: options.args || [],
      kwargs: options.kwargs || {},
      retries: 0,
      eta: undefined,
      expires: options.expires,
      utc: true,
      timelimit: [
        options.softTimeLimit || null,
        options.hardTimeLimit || null,
      ],
    };

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-encoding": "utf-8",
    };

    ch.publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify(messageProperties)),
      {
        persistent: true,
        contentType: "application/json",
        contentEncoding: "utf-8",
        headers,
        expiration: options.expires ? String(options.expires) : undefined,
      },
    );

    log.info(
      { taskId, taskName: options.taskName, queue },
      "Celery task dispatched",
    );

    return taskId;
  }

  async getTaskResult(
    taskId: string,
    timeoutMs: number = 300_000,
  ): Promise<CeleryTaskResult> {
    const ch = await this.ensureChannel();
    const exchange = "celery-result";
    const routingKey = taskId;

    await ch.assertExchange(exchange, "topic", { durable: true });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task ${taskId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      ch.assertQueue("", { exclusive: true, autoDelete: true })
        .then(({ queue }) => {
          ch.bindQueue(queue, exchange, routingKey);
          ch.consume(queue, (msg) => {
            if (!msg) return;
            clearTimeout(timer);
            try {
              const parsed = JSON.parse(msg.content.toString());
              const meta = parsed.meta || parsed.result || {};
              resolve({
                taskId,
                status: parsed.status || "SUCCESS",
                result: parsed.result || parsed,
                traceback: parsed.traceback,
                meta: typeof meta === "object" ? meta as Record<string, unknown> : undefined,
              });
            } catch (err) {
              resolve({
                taskId,
                status: "SUCCESS",
                result: msg.content.toString(),
              });
            } finally {
              ch.ack(msg);
            }
          });
        })
        .catch(reject);
    });
  }

  async revokeTask(taskId: string): Promise<void> {
    const ch = await this.ensureChannel();
    await ch.assertExchange("celery", "direct", { durable: true });

    const revokeMsg = {
      task: taskId,
      id: randomUUID(),
      args: [],
      kwargs: {},
      utc: true,
      terminate: true,
      signal: "SIGTERM",
    };

    ch.publish(
      "celery",
      "celery.control",
      Buffer.from(JSON.stringify(revokeMsg)),
      { persistent: true, contentType: "application/json", contentEncoding: "utf-8" },
    );

    log.info({ taskId }, "Celery revoke sent");
  }

  private async ensureChannel(): Promise<Channel> {
    if (this.channel) return this.channel;
    await this.connect();
    if (!this.channel) throw new Error("Celery bridge not connected");
    return this.channel;
  }

  async shutdown(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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

let _instance: CeleryBridge | null = null;

export function getCeleryBridge(): CeleryBridge {
  if (!_instance) {
    _instance = new CeleryBridge();
  }
  return _instance;
}
