/**
 * AIM-4442 — session store.
 *
 * One conversation = one session = one row. Every completed turn checkpoints
 * the transcript plus the curated agent memory, so a conversation survives pod
 * death, gateway restart and scale-to-zero: the rehydrator only has to read
 * this row to continue where it left off.
 *
 * Two implementations behind the same interface:
 *   - MemoryChatSessionStore  — in-memory, capped (tests, eval, scale-to-zero demo)
 *   - PostgresChatSessionStore — durable, backed by `chat_sessions` (migration 020)
 */

import type { SessionMemory } from '../agent/memory/types.js';
import { queryWithRetry } from '../db/connection.js';
import { emptySessionMemory } from './memory-block.js';

export type SessionStatus = 'active' | 'idle' | 'closed';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  ts?: string;
  delivered?: boolean;
}

export interface ChatSession {
  threadTs: string;
  channelId: string;
  sessionId: string;
  userId: string;
  state: Record<string, unknown>;
  agentMemory: SessionMemory;
  status: SessionStatus;
  updatedAt: string;
  createdAt: string;
}

export interface CheckpointInput {
  threadTs: string;
  channelId: string;
  sessionId: string;
  userId: string;
  state: Record<string, unknown>;
  agentMemory: SessionMemory;
}

export interface ChatSessionStore {
  get(threadTs: string): Promise<ChatSession | undefined>;
  upsert(checkpoint: CheckpointInput): Promise<ChatSession>;
  setStatus(threadTs: string, status: SessionStatus): Promise<void>;
  listByUser(userId: string, limit?: number): Promise<ChatSession[]>;
  remove(threadTs: string): Promise<void>;
}

const EMPTY_STATE: Record<string, unknown> = { transcript: [] };
const MEMORY_STORE_CAP = 5000;
const USER_SESSION_CAP = 1000;

/** In-memory store with per-user + total LRU caps. */
export class MemoryChatSessionStore implements ChatSessionStore {
  private readonly sessions = new Map<string, ChatSession>();

  private enforceCaps(ownerUserId: string): void {
    const byUser = [...this.sessions.values()]
      .filter((s) => s.userId === ownerUserId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const stale of byUser.slice(USER_SESSION_CAP)) this.sessions.delete(stale.threadTs);

    if (this.sessions.size > MEMORY_STORE_CAP) {
      const all = [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      for (const stale of all.slice(MEMORY_STORE_CAP)) this.sessions.delete(stale.threadTs);
    }
  }

  async get(threadTs: string): Promise<ChatSession | undefined> {
    return this.sessions.get(threadTs);
  }

  async upsert(checkpoint: CheckpointInput): Promise<ChatSession> {
    const now = new Date().toISOString();
    const existing = this.sessions.get(checkpoint.threadTs);
    const session: ChatSession = {
      ...checkpoint,
      state: checkpoint.state ?? EMPTY_STATE,
      agentMemory: checkpoint.agentMemory ?? emptySessionMemory(),
      status: existing?.status ?? 'active',
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    };
    this.sessions.set(checkpoint.threadTs, session);
    this.enforceCaps(checkpoint.userId);
    return session;
  }

  async setStatus(threadTs: string, status: SessionStatus): Promise<void> {
    const existing = this.sessions.get(threadTs);
    if (!existing) return;
    existing.status = status;
    existing.updatedAt = new Date().toISOString();
  }

  async listByUser(userId: string, limit = 50): Promise<ChatSession[]> {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async remove(threadTs: string): Promise<void> {
    this.sessions.delete(threadTs);
  }
}

interface ChatSessionRow {
  thread_ts: string;
  channel_id: string;
  session_id: string;
  user_id: string;
  state: unknown;
  agent_memory: unknown;
  status: SessionStatus;
  updated_at: string;
  created_at: string;
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to default
    }
  }
  return EMPTY_STATE;
}

function parseAgentMemory(raw: unknown): SessionMemory {
  let parsed: Record<string, unknown> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) parsed = raw as Record<string, unknown>;
  else if (typeof raw === 'string') {
    try {
      const candidate = JSON.parse(raw) as unknown;
      if (candidate && typeof candidate === 'object') parsed = candidate as Record<string, unknown>;
    } catch {
      // fall through to empty memory
    }
  }
  return {
    facts: Array.isArray(parsed.facts) ? (parsed.facts as SessionMemory['facts']) : [],
    decisions: Array.isArray(parsed.decisions) ? (parsed.decisions as SessionMemory['decisions']) : [],
    ...(parsed.plan && typeof parsed.plan === 'object' ? { plan: parsed.plan as SessionMemory['plan'] } : {}),
    preferences: Array.isArray(parsed.preferences) ? (parsed.preferences as SessionMemory['preferences']) : [],
  };
}

function toRow(checkpoint: CheckpointInput, status: SessionStatus): ChatSessionRow {
  const now = new Date().toISOString();
  return {
    thread_ts: checkpoint.threadTs,
    channel_id: checkpoint.channelId,
    session_id: checkpoint.sessionId,
    user_id: checkpoint.userId,
    state: JSON.stringify(checkpoint.state ?? EMPTY_STATE),
    agent_memory: JSON.stringify(checkpoint.agentMemory ?? emptySessionMemory()),
    status,
    updated_at: now,
    created_at: now,
  };
}

/** Durable store backed by the `chat_sessions` table (migration 020). */
export class PostgresChatSessionStore implements ChatSessionStore {
  async get(threadTs: string): Promise<ChatSession | undefined> {
    const result = await queryWithRetry<ChatSessionRow>('SELECT * FROM chat_sessions WHERE thread_ts = $1', [threadTs]);
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      threadTs: row.thread_ts,
      channelId: row.channel_id,
      sessionId: row.session_id,
      userId: row.user_id,
      state: parseJsonObject(row.state),
      agentMemory: parseAgentMemory(row.agent_memory),
      status: row.status ?? 'active',
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    };
  }

  async upsert(checkpoint: CheckpointInput): Promise<ChatSession> {
    const existing = await this.get(checkpoint.threadTs);
    const status = existing?.status ?? 'active';
    const row = toRow(checkpoint, status);
    const now = new Date().toISOString();
    await queryWithRetry(
      `INSERT INTO chat_sessions (thread_ts, channel_id, session_id, user_id, state, agent_memory, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (thread_ts) DO UPDATE SET
         channel_id = EXCLUDED.channel_id,
         session_id = EXCLUDED.session_id,
         user_id = EXCLUDED.user_id,
         state = EXCLUDED.state,
         agent_memory = EXCLUDED.agent_memory,
         status = chat_sessions.status,
         updated_at = NOW()`,
      [row.thread_ts, row.channel_id, row.session_id, row.user_id, row.state, row.agent_memory, row.status],
    );
    return {
      threadTs: row.thread_ts,
      channelId: row.channel_id,
      sessionId: row.session_id,
      userId: row.user_id,
      state: parseJsonObject(row.state),
      agentMemory: parseAgentMemory(row.agent_memory),
      status,
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    };
  }

  async setStatus(threadTs: string, status: SessionStatus): Promise<void> {
    await queryWithRetry('UPDATE chat_sessions SET status = $2, updated_at = NOW() WHERE thread_ts = $1', [
      threadTs,
      status,
    ]);
  }

  async listByUser(userId: string, limit = 50): Promise<ChatSession[]> {
    const result = await queryWithRetry<ChatSessionRow>(
      'SELECT * FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
      [userId, limit],
    );
    return result.rows.map((row) => ({
      threadTs: row.thread_ts,
      channelId: row.channel_id,
      sessionId: row.session_id,
      userId: row.user_id,
      state: parseJsonObject(row.state),
      agentMemory: parseAgentMemory(row.agent_memory),
      status: row.status ?? 'active',
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    }));
  }

  async remove(threadTs: string): Promise<void> {
    await queryWithRetry('DELETE FROM chat_sessions WHERE thread_ts = $1', [threadTs]);
  }
}

export type SessionStoreKind = 'memory' | 'postgres';

export function createSessionStore(kind: SessionStoreKind): ChatSessionStore {
  if (kind === 'postgres') {
    try {
      return new PostgresChatSessionStore();
    } catch {
      // No pool configured — fall back to memory so tests/evals still run.
      return new MemoryChatSessionStore();
    }
  }
  return new MemoryChatSessionStore();
}
