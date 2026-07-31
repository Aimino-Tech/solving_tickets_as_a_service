/**
 * Memory store — durable, capped, Hermes-style structured memory for a session.
 *
 * The store owns two layers:
 *  1. a raw transcript (`conversations`) for recent-context injection;
 *  2. a curated memory (`facts`, `decisions`, `plan`, `preferences`) that the
 *     agent maintains each turn and that is seeded on rehydrate.
 *
 * Persistence is a JSON file (like the oc-slack memory store this ports),
 * written debounced so a crash loses at most one in-flight turn. A session
 * store (Postgres `sessions.agent_memory`) can adopt the same shape later by
 * implementing the same read/write contract.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ConversationEntry,
  MemoryDecision,
  MemoryFact,
  MemoryPlan,
  MemoryPreference,
  SessionMemory,
} from './types.js';
import { MEMORY_LIMITS } from './types.js';

/** Shape of the on-disk store file. */
interface StoreFile {
  conversations: ConversationEntry[];
  facts: MemoryFact[];
  decisions: MemoryDecision[];
  plan?: MemoryPlan;
  preferences: MemoryPreference[];
}

/** Options for the memory store. */
export interface MemoryStoreOptions {
  /** Directory to persist the JSON file into. */
  dataDir: string;
  /** Debounce window for saves in ms. */
  saveDebounceMs?: number;
  /** Facts cap per session (default MEMORY_LIMITS.facts). */
  maxFacts?: number;
  /** Decisions cap per session (default MEMORY_LIMITS.decisions). */
  maxDecisions?: number;
  /** Preferences cap per session (default MEMORY_LIMITS.preferences). */
  maxPreferences?: number;
}

let lastTimestampMs = 0;

/**
 * Monotonic ISO timestamp: each call is strictly newer than the previous one.
 * Required so LRU eviction and access ordering are deterministic even when
 * multiple mutations happen inside the same millisecond.
 */
function nowIso(): string {
  const now = Date.now();
  lastTimestampMs = Math.max(now, lastTimestampMs + 1);
  return new Date(lastTimestampMs).toISOString();
}

/** Sort helper: oldest access first (for LRU eviction). */
function byOldestAccess(
  a: MemoryFact | MemoryDecision | MemoryPreference,
  b: MemoryFact | MemoryDecision | MemoryPreference,
): number {
  return a.lastAccessedAt.localeCompare(b.lastAccessedAt);
}

/**
 * Capped, file-backed memory store for one agent session.
 *
 * All mutations are persisted debounced; `flush()` forces a synchronous
 * write (call on shutdown / checkpoint).
 */
export class MemoryStore {
  readonly dataDir: string;
  private filePath: string;
  private saveDebounceMs: number;
  private maxFacts: number;
  private maxDecisions: number;
  private maxPreferences: number;

  private data: StoreFile;
  private dirty = false;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(options: MemoryStoreOptions) {
    this.dataDir = options.dataDir;
    this.filePath = join(this.dataDir, 'memory-store.json');
    this.saveDebounceMs = options.saveDebounceMs ?? 500;
    this.maxFacts = options.maxFacts ?? MEMORY_LIMITS.facts;
    this.maxDecisions = options.maxDecisions ?? MEMORY_LIMITS.decisions;
    this.maxPreferences = options.maxPreferences ?? MEMORY_LIMITS.preferences;
    this.data = this.load();
  }

  // ---------------------------------------------------------------- loading

  private load(): StoreFile {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      return {
        conversations: parsed.conversations ?? [],
        facts: parsed.facts ?? [],
        decisions: parsed.decisions ?? [],
        plan: parsed.plan,
        preferences: parsed.preferences ?? [],
      };
    } catch {
      return { conversations: [], facts: [], decisions: [], preferences: [] };
    }
  }

  /** Wipe all stored data for this store. */
  clear(): void {
    this.data = { conversations: [], facts: [], decisions: [], preferences: [] };
    this.dirty = true;
    this.flush();
  }

  // ---------------------------------------------------------------- saving

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, this.saveDebounceMs);
  }

  /** Force a synchronous write of all pending state. */
  flush(): void {
    if (!this.dirty) {
      return;
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    this.dirty = false;
  }

  /**
   * Clear any pending debounce timer and synchronously flush pending state.
   * Idempotent: safe to call multiple times or when nothing is pending.
   */
  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.flush();
  }

  /**
   * Register process shutdown hooks that flush pending state on exit.
   * Returns an unsubscribe function that removes the registered listeners.
   */
  registerShutdownHooks(
    signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'beforeExit'] as NodeJS.Signals[],
  ): () => void {
    const handler = (): void => {
      this.close();
    };
    for (const signal of signals) {
      process.on(signal, handler);
    }
    return () => {
      for (const signal of signals) {
        process.off(signal, handler);
      }
    };
  }

  // --------------------------------------------------------- conversations

  /** Record one side of an exchange (user or assistant turn). */
  addConversation(entry: Omit<ConversationEntry, 'id' | 'createdAt'>): ConversationEntry {
    const stored: ConversationEntry = { ...entry, id: randomUUID(), createdAt: nowIso() };
    this.data.conversations.push(stored);
    this.scheduleSave();
    return stored;
  }

  /** Most recent conversation entries for a session (newest last). */
  getConversations(sessionId: string, limit = 20): ConversationEntry[] {
    return this.data.conversations.filter((c) => c.sessionId === sessionId).slice(-limit);
  }

  /** Substring search over conversation content (case-insensitive). */
  searchConversations(keyword: string, limit = 10): ConversationEntry[] {
    const needle = keyword.toLowerCase();
    return this.data.conversations
      .filter((c) => c.content.toLowerCase().includes(needle) || c.channel?.toLowerCase().includes(needle))
      .slice(-limit);
  }

  // ----------------------------------------------------------------- facts

  /**
   * Upsert a fact by `(key, instance)`. Re-adding an existing key bumps
   * `accessCount` and refreshes `lastAccessedAt` instead of duplicating.
   */
  addFact(fact: Omit<MemoryFact, 'accessCount' | 'createdAt' | 'lastAccessedAt'>): MemoryFact {
    const existing = this.data.facts.find((f) => f.key === fact.key && f.instance === fact.instance);
    if (existing) {
      const merged: MemoryFact = {
        ...existing,
        ...fact,
        accessCount: existing.accessCount + 1,
        lastAccessedAt: nowIso(),
      };
      this.data.facts = this.data.facts.map((f) => (f === existing ? merged : f));
      this.scheduleSave();
      return merged;
    }
    const created: MemoryFact = {
      ...fact,
      accessCount: 1,
      createdAt: nowIso(),
      lastAccessedAt: nowIso(),
    };
    this.data.facts.push(created);
    this.evictToCap('facts');
    this.scheduleSave();
    return created;
  }

  /** All facts for an instance, most recently accessed first. */
  getFacts(instance: string, limit = 20): MemoryFact[] {
    return this.data.facts
      .filter((f) => f.instance === instance)
      .sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))
      .slice(0, limit);
  }

  /** Keyword search over fact content/key/tags (case-insensitive). Touches matching facts (LRU). */
  searchFacts(keyword: string, instance: string, limit = 10): MemoryFact[] {
    const needle = keyword.toLowerCase();
    const matches = this.data.facts.filter(
      (f) =>
        f.instance === instance &&
        (f.content.toLowerCase().includes(needle) ||
          f.key.toLowerCase().includes(needle) ||
          f.tags.some((t) => t.toLowerCase().includes(needle))),
    );
    for (const fact of matches) {
      fact.accessCount += 1;
      fact.lastAccessedAt = nowIso();
    }
    if (matches.length > 0) {
      this.scheduleSave();
    }
    return matches.sort((a, b) => b.accessCount - a.accessCount).slice(0, limit);
  }

  // -------------------------------------------------------------- decisions

  /** Upsert a decision by `(key, instance)`; re-adding refreshes access time. */
  addDecision(decision: Omit<MemoryDecision, 'createdAt' | 'lastAccessedAt'>): MemoryDecision {
    const existing = this.data.decisions.find((d) => d.key === decision.key && d.instance === decision.instance);
    if (existing) {
      const merged: MemoryDecision = {
        ...existing,
        ...decision,
        lastAccessedAt: nowIso(),
      };
      this.data.decisions = this.data.decisions.map((d) => (d === existing ? merged : d));
      this.scheduleSave();
      return merged;
    }
    const created: MemoryDecision = {
      ...decision,
      createdAt: nowIso(),
      lastAccessedAt: nowIso(),
    };
    this.data.decisions.push(created);
    this.evictToCap('decisions');
    this.scheduleSave();
    return created;
  }

  /** All decisions for an instance, most recently accessed first. */
  getDecisions(instance: string, limit = 20): MemoryDecision[] {
    return this.data.decisions
      .filter((d) => d.instance === instance)
      .sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))
      .slice(0, limit);
  }

  // ----------------------------------------------------------------- plan

  /** Set (replace) the plan of record for an instance. */
  setPlan(plan: MemoryPlan): void {
    this.data.plan = plan;
    this.scheduleSave();
  }

  /** The current plan of record. */
  getPlan(): MemoryPlan | undefined {
    return this.data.plan;
  }

  // ------------------------------------------------------------ preferences

  /** Upsert a preference by `(key, instance)`. */
  addPreference(preference: Omit<MemoryPreference, 'createdAt' | 'lastAccessedAt'>): MemoryPreference {
    const existing = this.data.preferences.find((p) => p.key === preference.key && p.instance === preference.instance);
    if (existing) {
      const merged: MemoryPreference = {
        ...existing,
        ...preference,
        lastAccessedAt: nowIso(),
      };
      this.data.preferences = this.data.preferences.map((p) => (p === existing ? merged : p));
      this.scheduleSave();
      return merged;
    }
    const created: MemoryPreference = {
      ...preference,
      createdAt: nowIso(),
      lastAccessedAt: nowIso(),
    };
    this.data.preferences.push(created);
    this.evictToCap('preferences');
    this.scheduleSave();
    return created;
  }

  /** All preferences for an instance, most recently accessed first. */
  getPreferences(instance: string, limit = 20): MemoryPreference[] {
    return this.data.preferences
      .filter((p) => p.instance === instance)
      .sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))
      .slice(0, limit);
  }

  // ----------------------------------------------------------------- misc

  /** The full structured memory (curated layer only) for serialization. */
  snapshot(): SessionMemory {
    return {
      facts: this.data.facts,
      decisions: this.data.decisions,
      plan: this.data.plan,
      preferences: this.data.preferences,
    };
  }

  /** Replace the curated memory wholesale (used when seeding from a session store). */
  seed(memory: SessionMemory): void {
    this.data.facts = memory.facts ?? [];
    this.data.decisions = memory.decisions ?? [];
    this.data.plan = memory.plan;
    this.data.preferences = memory.preferences ?? [];
    this.dirty = true;
    this.flush();
  }

  /** Counts for stats/health endpoints. */
  getStats(): { conversations: number; facts: number; decisions: number; plan: boolean; preferences: number } {
    return {
      conversations: this.data.conversations.length,
      facts: this.data.facts.length,
      decisions: this.data.decisions.length,
      plan: this.data.plan !== undefined,
      preferences: this.data.preferences.length,
    };
  }

  // ------------------------------------------------------------- eviction

  private evictToCap(kind: 'facts' | 'decisions' | 'preferences'): void {
    const cap = kind === 'facts' ? this.maxFacts : kind === 'decisions' ? this.maxDecisions : this.maxPreferences;
    if (kind === 'facts' && this.data.facts.length > cap) {
      this.data.facts.sort(byOldestAccess);
      this.data.facts = this.data.facts.slice(-cap);
    } else if (kind === 'decisions' && this.data.decisions.length > cap) {
      this.data.decisions.sort(byOldestAccess);
      this.data.decisions = this.data.decisions.slice(-cap);
    } else if (kind === 'preferences' && this.data.preferences.length > cap) {
      this.data.preferences.sort(byOldestAccess);
      this.data.preferences = this.data.preferences.slice(-cap);
    }
  }
}
