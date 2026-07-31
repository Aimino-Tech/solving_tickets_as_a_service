/**
 * AIM-4442 — rehydrator.
 *
 * After pod death, gateway restart or scale-to-zero, a fresh pod must continue
 * the same conversation from the durable store — the user never re-explains.
 * The rehydrator turns a `chat_sessions` row into everything a fresh session
 * needs to be seeded: the rendered agent-memory block, the recent transcript,
 * and any user turns that arrived while no pod was live. An optional Slack
 * thread fetch backfills turns the store has not seen yet.
 */

import { renderSessionMemoryBlock } from './memory-block.js';
import type { ChatSession, ChatSessionStore, TranscriptEntry } from './sessionStore.js';

export interface ThreadTurn {
  ts: string;
  userId: string;
  text: string;
}

export interface ThreadFetcher {
  fetchThread(threadTs: string): Promise<ThreadTurn[]>;
}

export interface RehydrationSeed {
  session: ChatSession;
  memoryBlock: string;
  recentTranscript: TranscriptEntry[];
  pendingTurns: TranscriptEntry[];
  rehydratedAt: string;
}

export const noThreadFetcher: ThreadFetcher = {
  fetchThread: async () => [],
};

function asTranscript(state: Record<string, unknown>): TranscriptEntry[] {
  const raw = state.transcript;
  return Array.isArray(raw) ? (raw as TranscriptEntry[]) : [];
}

export class ChatRehydrator {
  private readonly store: ChatSessionStore;
  private readonly threads: ThreadFetcher;

  constructor(store: ChatSessionStore, threads: ThreadFetcher = noThreadFetcher) {
    this.store = store;
    this.threads = threads;
  }

  async rehydrate(threadTs: string): Promise<RehydrationSeed | undefined> {
    const session = await this.store.get(threadTs);
    if (!session) return undefined;

    const transcript = asTranscript(session.state);
    const pendingTurns = transcript.filter((t) => t.role === 'user' && t.delivered === false);

    const thread = await this.threads.fetchThread(threadTs);
    const backfilled: TranscriptEntry[] = thread
      .filter((turn) => !transcript.some((t) => t.ts === turn.ts))
      .map((turn) => ({ role: 'user', text: turn.text, ts: turn.ts }));

    return {
      session,
      memoryBlock: renderSessionMemoryBlock(session.agentMemory),
      recentTranscript: [...transcript, ...backfilled].slice(-8),
      pendingTurns: [...pendingTurns, ...backfilled],
      rehydratedAt: new Date().toISOString(),
    };
  }
}
