/**
 * Ambient declarations for `@opencode-ai/sdk`.
 *
 * The SDK is an optional runtime dependency of the chat pod: it is installed in
 * the production pod image but deliberately NOT a package.json dependency of
 * this repo (the eval harness uses the deterministic memory/goldfish executors
 * and never loads it). OpenCodeExecutor lazily imports it at runtime, so this
 * ambient module lets `tsc --noEmit` type-check the call site without the
 * package present.
 */

declare module '@opencode-ai/sdk' {
  export interface OpenCodeSession {
    create(input: { title?: string }): Promise<unknown>;
    prompt?(input: unknown): Promise<unknown>;
  }

  export interface OpenCodeClient {
    session: OpenCodeSession;
  }

  export interface PromptWithPollingOptions {
    sessionId: string;
    prompt: string;
    onResponse?: (response: unknown) => void;
    [key: string]: unknown;
  }

  export interface PromptResult {
    text?: string;
    finish?: string;
    [key: string]: unknown;
  }

  export function createSession(options: { url: string }): OpenCodeClient;
  export function promptWithPolling(client: OpenCodeClient, options: PromptWithPollingOptions): Promise<PromptResult>;
}
