/**
 * Mock factories for STAS external dependencies.
 *
 * Each factory returns a fully mocked instance of the corresponding dependency,
 * with all commonly-used methods stubbed as vi.fn() returning sensible defaults.
 *
 * Usage:
 *   import { mockOctokit } from "./mocks.js";
 *   const octokit = mockOctokit();
 *   octokit.issues.createComment.mockResolvedValue({ data: { id: 1 } });
 */

import { vi } from "vitest";

// ── Octokit ────────────────────────────────────────────────────────────────

export interface MockOctokitInstance {
  issues: {
    createComment: ReturnType<typeof vi.fn>;
    listComments: ReturnType<typeof vi.fn>;
  };
  pulls: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  git: {
    createRef: ReturnType<typeof vi.fn>;
    getRef: ReturnType<typeof vi.fn>;
  };
  repos: {
    getContent: ReturnType<typeof vi.fn>;
  };
}

/**
 * Create a mocked Octokit instance with all methods used by STAS.
 */
export function mockOctokit(): MockOctokitInstance {
  return {
    issues: {
      createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
      listComments: vi.fn().mockResolvedValue({ data: [] }),
    },
    pulls: {
      create: vi.fn().mockResolvedValue({
        data: {
          id: 1,
          number: 42,
          html_url: "https://github.com/owner/repo/pull/42",
        },
      }),
      update: vi.fn().mockResolvedValue({ data: {} }),
    },
    git: {
      createRef: vi.fn().mockResolvedValue({ data: { ref: "refs/heads/test" } }),
      getRef: vi.fn().mockResolvedValue({
        data: { object: { sha: "abc123" } },
      }),
    },
    repos: {
      getContent: vi.fn().mockResolvedValue({
        data: { content: Buffer.from("test content").toString("base64") },
      }),
    },
  };
}

// ── BullMQ ─────────────────────────────────────────────────────────────────

export interface MockQueueInstance {
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
  getJobs: ReturnType<typeof vi.fn>;
  obliterate: ReturnType<typeof vi.fn>;
}

export interface MockWorkerInstance {
  run: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
}

/**
 * Create a mocked BullMQ Queue class.
 */
export function mockBullMQQueue(queueName?: string): MockQueueInstance {
  return {
    add: vi.fn().mockResolvedValue({ id: "mock-job-id", name: queueName ?? "stas:issues" }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    getJob: vi.fn().mockResolvedValue(null),
    getJobs: vi.fn().mockResolvedValue([]),
    obliterate: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mocked BullMQ Worker class.
 */
export function mockBullMQWorker(): MockWorkerInstance {
  return {
    run: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
  };
}

export interface MockQueueEventsInstance {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

/**
 * Create a mocked BullMQ QueueEvents instance.
 */
export function mockBullMQQueueEvents(): MockQueueEventsInstance {
  return {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ── E2B Sandbox ────────────────────────────────────────────────────────────

export interface MockE2BSandboxInstance {
  sandboxId: string;
  commands: {
    run: ReturnType<typeof vi.fn>;
  };
  files: {
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    makeDir: ReturnType<typeof vi.fn>;
  };
  kill: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

/**
 * Create a mocked E2B Sandbox instance.
 */
export function mockE2BSandbox(): MockE2BSandboxInstance {
  return {
    sandboxId: "mock-sandbox-id",
    commands: {
      run: vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    },
    files: {
      read: vi.fn().mockResolvedValue(""),
      write: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      makeDir: vi.fn().mockResolvedValue(undefined),
    },
    kill: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ── OpenAI ─────────────────────────────────────────────────────────────────

export interface MockOpenAIInstance {
  chat: {
    completions: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

/**
 * Create a mocked OpenAI instance.
 */
export function mockOpenAI(): MockOpenAIInstance {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          id: "chatcmpl-mock",
          object: "chat.completion",
          created: Date.now(),
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Mock response from OpenAI",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        }),
      },
    },
  };
}

// ── Pino Logger ────────────────────────────────────────────────────────────

export interface MockPinoLoggerInstance {
  level: string;
  child: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  silent: ReturnType<typeof vi.fn>;
}

/**
 * Create a mocked pino logger.
 */
export function mockPinoLogger(): MockPinoLoggerInstance {
  const child = vi.fn().mockReturnThis();
  return {
    level: "silent",
    child,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
  };
}
