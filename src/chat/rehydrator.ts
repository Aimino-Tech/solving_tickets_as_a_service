/**
 * AIM-4443 — Rehydrator.
 *
 * Pure read (Slack thread history + session row from the store) + seed a fresh
 * session. On pod death / scale-to-zero / gateway restart, the rehydrator
 * rebuilds a session from the durable store: it injects the maintained agent
 * memory block and the recent transcript, so the conversation continues
 * coherently — never as a cold start that makes the user re-explain.
 */

import { seedMemoryBlock } from './memory.js';
import type { ChatSession, ChatSessionStore } from './sessionStore.js';

export interface RehydrateResult {
  sessionId: string;
  threadTs: string;
  userId: string;
  memoryBlock: string;
  recentTranscript: Array<{ role: 'user' | 'assistant'; text: string }>;
  seedPrompt: string;
}

export interface RehydrateInput {
  store: ChatSessionStore;
  threadTs: string;
  channelId: string;
  userId: string;
  sessionId?: string;
  recentCount?: number;
}

export const RECENT_TRANSCRIPT_COUNT = 5;

export function buildSeedPrompt(
  memoryBlock: string,
  recentTranscript: Array<{ role: 'user' | 'assistant'; text: string }>,
): string {
  const parts: string[] = [];
  if (memoryBlock) parts.push(`[Memory]\n${memoryBlock}`);
  if (recentTranscript.length > 0) {
    parts.push(`[Recent Conversation History]\n${recentTranscript.map((t) => `${t.role}: ${t.text}`).join('\n')}`);
  }
  parts.push('Continue the conversation. The user should never need to re-explain anything already established.');
  return parts.join('\n\n');
}

export async function rehydrateSession(input: RehydrateInput): Promise<RehydrateResult> {
  const { store, threadTs, channelId, userId, recentCount = RECENT_TRANSCRIPT_COUNT } = input;

  let session: ChatSession | null = await store.get(threadTs);
  if (!session) {
    const sessionId = input.sessionId ?? `sess_${userId}_${threadTs.replace(/[^\w-]/g, '_')}`;
    const fresh: ChatSession = {
      threadTs,
      channelId,
      sessionId,
      userId,
      state: { transcript: [] },
      agentMemory: { facts: [], decisions: [], plan: null, preferences: {}, updatedAt: '' },
      status: 'active',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    await store.upsert(fresh);
    session = fresh;
  }

  const rawTranscript = Array.isArray(session.state.transcript) ? session.state.transcript : [];
  const transcript = rawTranscript as Array<{ role: 'user' | 'assistant'; text: string }>;
  const recent = transcript.slice(-recentCount);
  const memoryBlock = seedMemoryBlock(session.agentMemory);

  return {
    sessionId: session.sessionId,
    threadTs: session.threadTs,
    userId: session.userId,
    memoryBlock,
    recentTranscript: recent,
    seedPrompt: buildSeedPrompt(memoryBlock, recent),
  };
}
