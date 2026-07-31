import { queryWithRetry } from '../db/connection.js';
import type { AgentMemory } from './memory.js';
import { emptyMemory } from './memory.js';

export type SessionStatus = 'active' | 'idle' | 'closed';

/** One turn in a conversation transcript. `ts` is the trace id; `delivered` marks cold-start pending turns. */
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
  agentMemory: AgentMemory;
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
  agentMemory: AgentMemory;
}

export interface ChatSessionStore {
  get(threadTs: string): Promise<ChatSession | null>;
  upsert(checkpoint: CheckpointInput): Promise<ChatSession>;
  setStatus(threadTs: string, status: SessionStatus): Promise<void>;
  listByUser(userId: string, limit?: number): Promise<ChatSession[]>;
  listAll(limit?: number): Promise<ChatSession[]>;
  remove(threadTs: string): Promise<void>;
}

const EMPTY_STATE: Record<string, unknown> = { transcript: [] };

const MEMORY_STORE_CAP = 5_000;
const USER_SESSION_CAP = 1_000;

export class MemoryChatSessionStore implements ChatSessionStore {
  private sessions = new Map<string, ChatSession>();

  private enforceCaps(userId: string): void {
    const byUser = [...this.sessions.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (byUser.length > USER_SESSION_CAP) {
      for (const stale of byUser.slice(USER_SESSION_CAP)) this.sessions.delete(stale.threadTs);
    }
    if (this.sessions.size > MEMORY_STORE_CAP) {
      const all = [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      for (const stale of all.slice(MEMORY_STORE_CAP)) this.sessions.delete(stale.threadTs);
    }
  }

  async get(threadTs: string): Promise<ChatSession | null> {
    return this.sessions.get(threadTs) ?? null;
  }

  async upsert(checkpoint: CheckpointInput): Promise<ChatSession> {
    const now = new Date().toISOString();
    const existing = this.sessions.get(checkpoint.threadTs);
    const session: ChatSession = {
      threadTs: checkpoint.threadTs,
      channelId: checkpoint.channelId,
      sessionId: checkpoint.sessionId,
      userId: checkpoint.userId,
      state: checkpoint.state ?? EMPTY_STATE,
      agentMemory: checkpoint.agentMemory ?? emptyMemory(now),
      status: existing?.status ?? 'active',
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    };
    this.sessions.set(session.threadTs, session);
    this.enforceCaps(session.userId);
    return session;
  }

  async setStatus(threadTs: string, status: SessionStatus): Promise<void> {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.status = status;
      session.updatedAt = new Date().toISOString();
    }
  }

  async listByUser(userId: string, limit = 50): Promise<ChatSession[]> {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async listAll(limit = 50): Promise<ChatSession[]> {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  async remove(threadTs: string): Promise<void> {
    this.sessions.delete(threadTs);
  }
}

/** Snake_case row shape of the `chat_sessions` table. */
export interface ChatSessionRow {
  thread_ts: string;
  channel_id: string;
  session_id: string;
  user_id: string;
  state: unknown;
  agent_memory: unknown;
  status: SessionStatus;
  updated_at: string | Date;
  created_at: string | Date;
}

function toRow(checkpoint: CheckpointInput, status: SessionStatus): ChatSessionRow {
  return {
    thread_ts: checkpoint.threadTs,
    channel_id: checkpoint.channelId,
    session_id: checkpoint.sessionId,
    user_id: checkpoint.userId,
    state: JSON.stringify(checkpoint.state ?? EMPTY_STATE),
    agent_memory: JSON.stringify(checkpoint.agentMemory ?? {}),
    status,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

function fromRow(row: ChatSessionRow): ChatSession {
  return {
    threadTs: row.thread_ts,
    channelId: row.channel_id,
    sessionId: row.session_id,
    userId: row.user_id,
    state: parseJsonObject(row.state),
    agentMemory: parseAgentMemory(row.agent_memory),
    status: row.status ?? 'active',
    updatedAt: String(row.updated_at),
    createdAt: String(row.created_at),
  };
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : EMPTY_STATE;
    } catch {
      return EMPTY_STATE;
    }
  }
  return EMPTY_STATE;
}

function parseAgentMemory(raw: unknown): AgentMemory {
  const parsed = parseJsonObject(raw);
  const now = new Date().toISOString();
  return {
    facts: Array.isArray(parsed.facts) ? (parsed.facts as AgentMemory['facts']) : [],
    decisions: Array.isArray(parsed.decisions) ? (parsed.decisions as AgentMemory['decisions']) : [],
    plan: parsed.plan && typeof parsed.plan === 'object' ? (parsed.plan as AgentMemory['plan']) : null,
    preferences:
      parsed.preferences && typeof parsed.preferences === 'object'
        ? (parsed.preferences as Record<string, string>)
        : {},
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : now,
  };
}

export class PostgresChatSessionStore implements ChatSessionStore {
  async get(threadTs: string): Promise<ChatSession | null> {
    const result = await queryWithRetry<ChatSessionRow>('SELECT * FROM chat_sessions WHERE thread_ts = $1', [threadTs]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async upsert(checkpoint: CheckpointInput): Promise<ChatSession> {
    const existing = await this.get(checkpoint.threadTs);
    const status = existing?.status ?? 'active';
    const row = toRow(checkpoint, status);
    const now = new Date().toISOString();
    await queryWithRetry(
      `INSERT INTO chat_sessions
         (thread_ts, channel_id, session_id, user_id, state, agent_memory, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
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
    return fromRow({
      ...row,
      updated_at: now,
      created_at: existing?.createdAt ?? now,
    });
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
    return result.rows.map(fromRow);
  }

  async listAll(limit = 50): Promise<ChatSession[]> {
    const result = await queryWithRetry<ChatSessionRow>(
      'SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT $1',
      [limit],
    );
    return result.rows.map(fromRow);
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
      return new MemoryChatSessionStore();
    }
  }
  return new MemoryChatSessionStore();
}
