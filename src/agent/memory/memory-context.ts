/**
 * Memory context hooks — inject maintained memory before a prompt and record
 * turns (plus structured extractions) after a prompt.
 *
 * This is the port of the oc-slack MemoryPlugin, upgraded from a flat
 * keyword file store to the Hermes-style structured memory in memory-store.ts:
 * facts, decisions, plan and preferences, each capped, each seeded on
 * rehydrate so continuation never requires the user to re-explain.
 */

import type { MemoryStore } from './memory-store.js';
import { CONTEXT_SECTIONS } from './types.js';

/** Inputs needed to build context before a prompt. */
export interface BeforePromptParams {
  /** The user's message. */
  message: string;
  /** OpenCode session id. */
  sessionId: string;
  /** Instance (opencode server) name. */
  instance: string;
}

/** Inputs needed to record a completed exchange after a prompt. */
export interface AfterPromptParams extends BeforePromptParams {
  /** The assistant's reply. */
  response: string;
  /** Slack channel (or thread) id. */
  channel?: string;
  /** Slack user id. */
  user?: string;
}

/** The prompt block injected before a turn. */
export interface MemoryContextBlock {
  /** Section heading, one of CONTEXT_SECTIONS. */
  section: string;
  /** Rendered block content. */
  text: string;
}

/** Minimum response length before we auto-learn a topic fact. */
const MIN_RESPONSE_FOR_TOPIC = 80;
/** Replies that indicate the assistant had nothing useful to say. */
const NON_TOPIC_PREFIXES = ["I don't know", 'Sorry'];

/**
 * Build the memory context blocks for a session's current turn.
 * Returns blocks only for sections that have content, so the caller can join
 * them with blank lines and skip empty context entirely.
 */
export function buildMemoryContext(store: MemoryStore, params: BeforePromptParams): MemoryContextBlock[] {
  const blocks: MemoryContextBlock[] = [];

  const recent = store.getConversations(params.sessionId, 5);
  if (recent.length > 0) {
    const lines = recent.map((c) => `${c.role}: ${c.content.slice(0, 500)}`);
    blocks.push({ section: CONTEXT_SECTIONS[0], text: lines.join('\n') });
  }

  const facts = store.searchFacts(params.message, params.instance, 10);
  if (facts.length > 0) {
    const lines = facts.map((f) => `- ${f.key}: ${f.content}`);
    blocks.push({ section: CONTEXT_SECTIONS[1], text: lines.join('\n') });
  }

  const decisions = store.getDecisions(params.instance, 10);
  if (decisions.length > 0) {
    const lines = decisions.map((d) => `- ${d.content}`);
    blocks.push({ section: CONTEXT_SECTIONS[2], text: lines.join('\n') });
  }

  const plan = store.getPlan();
  if (plan) {
    const steps = plan.steps.length > 0 ? plan.steps.map((s) => `  ${s}`).join('\n') : '(no steps)';
    blocks.push({ section: CONTEXT_SECTIONS[3], text: `${plan.summary}\n${steps}` });
  }

  const preferences = store.getPreferences(params.instance, 10);
  if (preferences.length > 0) {
    const lines = preferences.map((p) => `- ${p.content}`);
    blocks.push({ section: CONTEXT_SECTIONS[4], text: lines.join('\n') });
  }

  return blocks;
}

/** Render context blocks as a single prompt-injection string (or undefined when empty). */
export function renderMemoryContext(store: MemoryStore, params: BeforePromptParams): string | undefined {
  const blocks = buildMemoryContext(store, params);
  if (blocks.length === 0) {
    return undefined;
  }
  return blocks.map((b) => `[${b.section}]\n${b.text}`).join('\n\n');
}

/**
 * Record one completed exchange: both turns into the transcript, plus a
 * structured auto-learned topic fact when the reply was substantive.
 */
export function recordExchange(store: MemoryStore, params: AfterPromptParams): void {
  store.addConversation({
    sessionId: params.sessionId,
    instance: params.instance,
    role: 'user',
    content: params.message,
    channel: params.channel,
    user: params.user,
  });
  store.addConversation({
    sessionId: params.sessionId,
    instance: params.instance,
    role: 'assistant',
    content: params.response,
    channel: params.channel,
    user: params.user,
  });

  const response = params.response.trim();
  const isSubstantive =
    response.length > MIN_RESPONSE_FOR_TOPIC && !NON_TOPIC_PREFIXES.some((prefix) => response.startsWith(prefix));

  if (isSubstantive) {
    const hasTopic = store
      .getFacts(params.instance, 100)
      .some((f) => f.key.startsWith('topic_') && f.content.includes(params.sessionId.slice(0, 8)));
    if (!hasTopic) {
      store.addFact({
        key: `topic_${params.sessionId.slice(0, 8)}`,
        content: `Session discussed topics related to: ${response.slice(0, 200)}`,
        instance: params.instance,
        source: 'auto',
        tags: ['auto-learned', `session:${params.sessionId}`],
      });
    }
  }
}

/**
 * Record a session-creation fact so rehydration knows the session existed.
 * Call when a session is first created (before the first prompt).
 */
export function recordSessionCreated(
  store: MemoryStore,
  params: { sessionId: string; instance: string; user?: string; channel?: string },
): void {
  store.addFact({
    key: `session_${params.sessionId}`,
    content: `Session created for instance "${params.instance}"${params.user ? ` by user ${params.user}` : ''}${params.channel ? ` in channel ${params.channel}` : ''}`,
    instance: params.instance,
    source: 'auto',
    tags: ['session-start', ...(params.channel ? [`channel:${params.channel}`] : [])],
  });
}
