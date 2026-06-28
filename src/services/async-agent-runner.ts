import { EventEmitter } from "events";
import { getCeleryBridge, type CeleryBridge } from "./celery-bridge.js";
import { getAsyncExecutionManager, type AsyncExecutionManager } from "./async-execution.js";
import { rootLogger } from "../utils/logger.js";

const log = rootLogger.child({ module: "async-agent-runner" });

export interface AgentSessionConfig {
  prompt: string;
  model?: string;
  maxIterations?: number;
  workspace?: string;
  repoUrl?: string;
  sessionTimeoutMs?: number;
}

export interface AgentSessionState {
  sessionId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  output?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentSessionEvent {
  sessionId: string;
  status: string;
  progress?: number;
  output?: string;
  timestamp: number;
}

export class AsyncAgentRunner {
  private bridge: CeleryBridge;
  private executionManager: AsyncExecutionManager;
  private emitter = new EventEmitter();
  private activeTasks: Map<string, string> = new Map();

  constructor() {
    this.bridge = getCeleryBridge();
    this.executionManager = getAsyncExecutionManager();
  }

  async startSession(
    sessionId: string,
    config: AgentSessionConfig,
  ): Promise<string> {
    const taskId = await this.bridge.sendTask({
      taskName: "workers.tasks.agent_session.execute_agent_session",
      args: [sessionId, {
        model: config.model,
        max_iterations: config.maxIterations,
        workspace: config.workspace,
        repo_url: config.repoUrl,
      }, config.prompt],
      kwargs: {},
      queue: "celery",
      routingKey: "celery",
      softTimeLimit: Math.floor((config.sessionTimeoutMs || 300_000) / 1000),
      hardTimeLimit: Math.floor((config.sessionTimeoutMs || 300_000) / 1000) + 60,
      expires: (config.sessionTimeoutMs || 300_000) + 60_000,
    });

    this.activeTasks.set(sessionId, taskId);
    log.info({ sessionId, taskId }, "Agent session started via Celery");

    await this.executionManager.registerExecution(sessionId, {
      taskId,
      prompt: config.prompt.substring(0, 200),
    });

    this.emitter.emit("session:update", {
      sessionId,
      status: "running",
      progress: 0,
      timestamp: Date.now(),
    } as AgentSessionEvent);

    this.pollTaskStatus(sessionId, taskId, config.sessionTimeoutMs || 300_000);

    return taskId;
  }

  private async pollTaskStatus(
    sessionId: string,
    taskId: string,
    timeoutMs: number,
  ): Promise<void> {
    try {
      const result = await this.bridge.getTaskResult(taskId, timeoutMs);
      const meta = result.meta || {};

      if (result.status === "SUCCESS") {
        await this.executionManager.updateStatus(
          sessionId,
          "completed",
          result.result,
        );
        this.emitter.emit("session:update", {
          sessionId,
          status: "completed",
          progress: 1.0,
          output: typeof result.result === "string"
            ? result.result
            : JSON.stringify(result.result),
          timestamp: Date.now(),
        } as AgentSessionEvent);
      } else {
        const errorMsg = String(result.result || result.traceback || "Unknown error");
        await this.executionManager.updateStatus(sessionId, "failed", undefined, errorMsg);
        this.emitter.emit("session:update", {
          sessionId,
          status: "failed",
          error: errorMsg,
          timestamp: Date.now(),
        } as AgentSessionEvent);
      }
    } catch (err) {
      const errorMsg = String(err);
      log.error({ sessionId, error: errorMsg }, "Agent session failed");
      await this.executionManager.updateStatus(sessionId, "failed", undefined, errorMsg);
      this.emitter.emit("session:update", {
        sessionId,
        status: "failed",
        error: errorMsg,
        timestamp: Date.now(),
      } as AgentSessionEvent);
    } finally {
      this.activeTasks.delete(sessionId);
    }
  }

  async getSessionResult(sessionId: string): Promise<AgentSessionState | null> {
    const state = await this.executionManager.getExecution(sessionId);
    if (!state) return null;

    return {
      sessionId: state.id,
      status: state.status as AgentSessionState["status"],
      progress: state.status === "completed" ? 1 : 0,
      output: state.result as string | undefined,
      error: state.error,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const taskId = this.activeTasks.get(sessionId);
    if (taskId) {
      try {
        await this.bridge.revokeTask(taskId);
      } catch (err) {
        log.warn({ sessionId, err: String(err) }, "Revoke failed");
      }
      this.activeTasks.delete(sessionId);
    }

    await this.executionManager.cancelExecution(sessionId);
    this.emitter.emit("session:update", {
      sessionId,
      status: "cancelled",
      timestamp: Date.now(),
    } as AgentSessionEvent);

    log.info({ sessionId }, "Agent session cancelled");
  }

  onUpdate(handler: (event: AgentSessionEvent) => void): void {
    this.emitter.on("session:update", handler);
  }

  offUpdate(handler: (event: AgentSessionEvent) => void): void {
    this.emitter.off("session:update", handler);
  }
}

let _instance: AsyncAgentRunner | null = null;

export function getAsyncAgentRunner(): AsyncAgentRunner {
  if (!_instance) {
    _instance = new AsyncAgentRunner();
  }
  return _instance;
}
