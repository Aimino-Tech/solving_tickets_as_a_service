/**
 * Agent memory type definitions — Hermes-style structured memory for
 * conversation continuity across turns, pod restarts and rehydration.
 *
 * Memory is a curated layer on top of the raw transcript: the transcript
 * records what was said, memory records what the agent should keep in mind
 * (facts, decisions, plan, preferences) so continuation does not require the
 * user to re-explain anything.
 */

/** A single stored conversation exchange (raw transcript line). */
export interface ConversationEntry {
  /** Unique id of this entry. */
  id: string;
  /** Session this entry belongs to. */
  sessionId: string;
  /** Instance (opencode server) the entry belongs to. */
  instance: string;
  /** Who said this: the user or the assistant. */
  role: 'user' | 'assistant';
  /** Message content. */
  content: string;
  /** Slack channel (or thread) id. */
  channel?: string;
  /** Slack user id of the author. */
  user?: string;
  /** ISO timestamp of the exchange. */
  createdAt: string;
}

/** A durable fact remembered about the user, project or conversation. */
export interface MemoryFact {
  /** Stable key used for upserts, e.g. `user_name` or `project_stack`. */
  key: string;
  /** Fact content — a single self-contained statement. */
  content: string;
  /** Instance this fact belongs to. */
  instance: string;
  /** Where the fact came from: 'user' | 'assistant' | 'auto'. */
  source: 'user' | 'assistant' | 'auto';
  /** Free-form tags for retrieval. */
  tags: string[];
  /** Number of times this fact has been recalled. */
  accessCount: number;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last access (used for LRU eviction). */
  lastAccessedAt: string;
}

/** A decision the user or agent made that must survive across turns. */
export interface MemoryDecision {
  /** Stable key for upserts, e.g. `auth_migration_decision`. */
  key: string;
  /** One-sentence statement of the decision. */
  content: string;
  /** Instance this decision belongs to. */
  instance: string;
  /** Optional context — what prompted the decision. */
  rationale?: string;
  /** ISO timestamp of when the decision was made. */
  createdAt: string;
  /** ISO timestamp of last access (used for LRU eviction). */
  lastAccessedAt: string;
}

/** The current plan of record for the conversation. */
export interface MemoryPlan {
  /** One-sentence summary of the plan. */
  summary: string;
  /** Ordered steps of the plan. */
  steps: string[];
  /** ISO timestamp of the last plan update. */
  updatedAt: string;
}

/** A user preference that must be honored across turns. */
export interface MemoryPreference {
  /** Stable key for upserts, e.g. `response_language`. */
  key: string;
  /** Preference statement, e.g. "Reply in German". */
  content: string;
  /** Instance this preference belongs to. */
  instance: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last access (used for LRU eviction). */
  lastAccessedAt: string;
}

/**
 * The full structured memory of a session — the curated layer persisted in
 * `sessions.agent_memory` and seeded on rehydrate.
 */
export interface SessionMemory {
  /** Facts, capped at 100 per session. */
  facts: MemoryFact[];
  /** Decisions, capped at 50 per session. */
  decisions: MemoryDecision[];
  /** The current plan — at most one per session. */
  plan?: MemoryPlan;
  /** Preferences, capped at 20 per session. */
  preferences: MemoryPreference[];
}

/** Capacity limits per session (from the AIM-4443 ticket spec). */
export const MEMORY_LIMITS = {
  facts: 100,
  decisions: 50,
  preferences: 20,
} as const;

/** Context block names injected into the prompt before each turn. */
export const CONTEXT_SECTIONS = [
  'Recent Conversation History',
  'Known Facts',
  'Decisions',
  'Current Plan',
  'Preferences',
] as const;
