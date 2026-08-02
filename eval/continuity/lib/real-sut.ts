/**
 * Real SUT for the continuity harness — a live opencode-serve conversation.
 *
 * Talks to a running `opencode serve` (the same server the AIM-4442 gateway
 * drives) over its REST API, authenticated with the `x-opencode-api-key`
 * header. One RealSUT instance = one conversation; `reset()` opens a fresh
 * session so each eval run is an independent conversation.
 *
 * `POST /session/{id}/message` blocks until the assistant turn completes, so
 * `ask()` is a single round trip — no polling needed.
 *
 * The harness itself still has no dependency on `@opencode-ai/sdk`.
 */
import type { ChatSUT } from './sut.js';

/** Structural fetch — lets tests inject a plain fake without a real Response. */
export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export interface RealSUTOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Workspace directory for the sessions this SUT opens. */
  directory?: string;
  /**
   * Agent to run the conversation (default: server default). Set to a
   * chat-friendly agent (e.g. "build") so the eval session answers without
   * firing blocking clarifying questions or long tool chains.
   */
  agent?: string;
  /** Per-request timeout in ms (default 5 minutes — model turns can be slow). */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetchFn?: FetchLike;
}

interface SessionInfo {
  id: string;
  modelID?: string;
}

interface JsonResponse {
  status: number;
  ok: boolean;
  bodyText: string;
  json: unknown;
}

export class RealSUT implements ChatSUT {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly directory: string;
  private readonly agent: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;
  private session: SessionInfo | null = null;

  constructor(options: RealSUTOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.OPENCODE_URL ?? 'http://127.0.0.1:20888').replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env.OPENCODE_API_KEY ?? '';
    this.directory = options.directory ?? '/tmp/opencode/eval-sut';
    this.agent = options.agent ?? process.env.OPENCODE_AGENT ?? undefined;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.name = `opencode-serve:${this.baseUrl}`;
  }

  /** Send one user message; returns the assistant's reply text. */
  async ask(message: string): Promise<string> {
    const session = await this.ensureSession();
    const response = await this.request(`/session/${session.id}/message`, {
      method: 'POST',
      body: JSON.stringify({ parts: [{ type: 'text', text: message }] }),
    });
    const payload = this.requireObject(response, 'assistant message');
    const info = payload.info;
    if (info === null || typeof info !== 'object' || Array.isArray(info)) {
      throw new Error(`RealSUT: assistant message missing info (session ${session.id})`);
    }
    if ((info as { finish?: unknown }).finish === 'error') {
      throw new Error(`RealSUT: assistant turn errored (session ${session.id})`);
    }
    const parts = Array.isArray(payload.parts) ? payload.parts : [];
    const text = parts
      .filter((part): part is { type: string; text: string } => {
        return (
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
        );
      })
      .map((part) => part.text)
      .join('\n');
    if (text.length === 0) {
      throw new Error(`RealSUT: assistant reply had no text parts (session ${session.id})`);
    }
    return text;
  }

  /** Simulate pod death: abort the in-flight turn and drop the session. */
  async kill(): Promise<void> {
    if (this.session === null) {
      return;
    }
    try {
      await this.request(`/session/${this.session.id}/abort`, { method: 'POST' });
    } catch {
      // Best effort — pod-death semantics mean the conversation is gone either way.
    }
    this.session = null;
  }

  /** Fresh conversation: the next ask() opens a new session. */
  async reset(): Promise<void> {
    this.session = null;
  }

  private async ensureSession(): Promise<SessionInfo> {
    if (this.session !== null) {
      return this.session;
    }
    const response = await this.request('/session', {
      method: 'POST',
      body: JSON.stringify(this.agent ? { workspace_dir: this.directory, agent: this.agent } : { workspace_dir: this.directory }),
    });
    const payload = this.requireObject(response, 'session create');
    const id = payload.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`RealSUT: session create returned no id: ${response.bodyText.slice(0, 200)}`);
    }
    const modelID = typeof payload.modelID === 'string' ? payload.modelID : undefined;
    this.session = { id, modelID };
    return this.session;
  }

  private async request(path: string, init: RequestInit): Promise<JsonResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-opencode-api-key': this.apiKey,
          ...init.headers,
        },
        signal: controller.signal,
      });
      const bodyText = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(bodyText);
      } catch {
        // Non-JSON body (e.g. the SPA fallback for unknown session ids).
      }
      if (!response.ok) {
        throw new Error(`RealSUT: HTTP ${response.status} on ${path}: ${bodyText.slice(0, 300)}`);
      }
      return { status: response.status, ok: response.ok, bodyText, json };
    } finally {
      clearTimeout(timer);
    }
  }

  private requireObject(response: JsonResponse, what: string): Record<string, unknown> {
    if (response.json === null || typeof response.json !== 'object' || Array.isArray(response.json)) {
      throw new Error(`RealSUT: expected JSON object for ${what}, got: ${response.bodyText.slice(0, 200)}`);
    }
    return response.json as Record<string, unknown>;
  }
}
