/**
 * Hermes-style maintained agent memory (AIM-4443).
 *
 * Memory is the curated layer above the raw transcript: facts, decisions,
 * plan, and preferences, capped and maintained after every completed turn.
 * It is seeded into a fresh session on rehydrate so a resumed conversation
 * continues coherently instead of as transcript replay.
 *
 * This is a deterministic, rule-based maintainer. The extraction rules below
 * are deliberately conservative — they only promote statements that are
 * expressed as stable, reusable facts. An LLM-backed curator can be dropped
 * in behind the same interface (`MemoryExtractor`).
 */

export interface MemoryFact {
  key: string;
  value: string;
  updatedAt: string;
}

export interface MemoryDecision {
  context: string;
  choice: string;
  reason: string;
  ts: string;
}

export interface MemoryPlan {
  goal: string;
  steps: string[];
  progress: string;
  updatedAt: string;
}

export interface AgentMemory {
  facts: MemoryFact[];
  decisions: MemoryDecision[];
  plan: MemoryPlan | null;
  preferences: Record<string, string>;
  updatedAt: string;
}

export interface MemoryDelta {
  facts?: MemoryFact[];
  decisions?: MemoryDecision[];
  plan?: MemoryPlan | null;
  preferences?: Record<string, string>;
}

export type MemoryExtractor = (prev: AgentMemory, userText: string, assistantText: string) => MemoryDelta;

export const MEMORY_CAPS = {
  facts: 100,
  decisions: 50,
  preferences: 50,
} as const;

export const EMPTY_MEMORY: AgentMemory = {
  facts: [],
  decisions: [],
  plan: null,
  preferences: {},
  updatedAt: new Date(0).toISOString(),
};

export function emptyMemory(now: string = new Date().toISOString()): AgentMemory {
  return { facts: [], decisions: [], plan: null, preferences: {}, updatedAt: now };
}

const FACT_PATTERNS: { key: string; re: RegExp }[] = [
  { key: 'user_name', re: /(?:my name is|i['’]?m called|call me)\s+([A-Z][a-z]+)/i },
  {
    key: 'project',
    re: /(?:the project is|we(?:['’]?re| are) (?:working on|building|using|on))\s+(?:a |an |the )?([A-Za-z0-9_\-./]+)/i,
  },
  { key: 'language', re: /(?:language|stack)(?:\s+is|\s+of|\s+we use|\s+we['’]?re using)?\s+([A-Za-z#+]+)/i },
  {
    key: 'framework',
    re: /(?:framework|using|built with)\s+([A-Za-z][A-Za-z0-9.\- ]{1,30}?)(?:\s+for|\s+to|\s+and|,|\.|$)/i,
  },
  { key: 'repo', re: /(?:repo(?:sitory)?\s+(?:is|at)|clone)\s+([A-Za-z0-9_\-/.]+)/i },
  { key: 'constraint', re: /(?:must|should|can['’]?t|cannot|no|keep)\s+(?:not\s+)?([a-z][a-z0-9 ]{3,60})/i },
];

const DECISION_PATTERNS: RegExp[] = [
  /(?:we|i|let['’]?s)\s+(?:decided|will go with|will use|should (?:use|go with|pick))\s+([^.,!?]{3,80})/i,
  /(?:decision|choice)(?:\s+is|\s+was)?\s*[:=]?\s*([^.,!?]{3,80})/i,
  /let['’]?s\s+(?:use|go with|pick|take)\s+([^.,!?]{3,80})/i,
];

const PLAN_PATTERNS: RegExp[] = [
  /(?:plan|approach)\s*(?:is|:)\s*([^.,!?]{3,120})/i,
  /(?:goal|objective)\s*(?:is|:)\s*([^.,!?]{3,120})/i,
  /(?:our )?next steps?(?:\s+are|:)?\s*([^.,!?]{3,120})/i,
];

const PREFERENCE_PATTERNS: { key: string; re: RegExp }[] = [
  { key: 'style', re: /(?:i|we|please)\s+prefer\s+(?:a )?([a-z][a-z0-9 ]{2,40})/i },
  { key: 'tone', re: /(?:keep it|make it|be|write in a)\s+([a-z][a-z0-9 ]{2,30})/i },
  { key: 'language_pref', re: /(?:i prefer|please respond in|answer in)\s+([a-z]+)/i },
];

function matchValue(re: RegExp, text: string): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function upsertFact(facts: MemoryFact[], key: string, value: string, ts: string): MemoryFact[] {
  const idx = facts.findIndex((f) => f.key === key);
  const fact: MemoryFact = { key, value, updatedAt: ts };
  if (idx >= 0) {
    const next = facts.slice();
    next[idx] = fact;
    return next;
  }
  return [...facts, fact].slice(-MEMORY_CAPS.facts);
}

/** Default deterministic extractor. Extends the extractor function. */
export const ruleBasedExtractor: MemoryExtractor = (prev, userText, assistantText) => {
  const ts = nowIso();
  const combined = `${userText}\n${assistantText}`;
  const delta: MemoryDelta = {};
  let facts = prev.facts.slice();
  const seen = new Set(facts.map((f) => f.key));

  for (const { key, re } of FACT_PATTERNS) {
    const value = matchValue(re, combined);
    if (value && !seen.has(key)) {
      facts = upsertFact(facts, key, value, ts);
      seen.add(key);
    }
  }

  // oc-slack style `topic_` fallback: assistant statements naming a keyword
  // become a reusable fact so the memory store is never empty.
  for (const line of assistantText.split('\n')) {
    const topic = line.match(/^(?:about|on|re)\s+([a-z][a-z0-9_-]{2,40})\s*[:-]?\s*(.{4,120})$/i);
    if (topic) {
      const key = `topic_${topic[1].toLowerCase().replace(/\s+/g, '_')}`;
      if (!seen.has(key)) {
        facts = upsertFact(facts, key, topic[2].trim(), ts);
        seen.add(key);
      }
    }
  }

  const decisions = prev.decisions.slice();
  for (const re of DECISION_PATTERNS) {
    const choice = matchValue(re, combined);
    if (choice) {
      const context = combined.split('\n').find((l) => l.trim().length > 0) ?? 'conversation';
      decisions.push({
        context: context.slice(0, 80),
        choice: choice.slice(0, 80),
        reason: 'stated in conversation',
        ts,
      });
      break;
    }
  }

  let plan = prev.plan;
  for (const re of PLAN_PATTERNS) {
    const goal = matchValue(re, combined);
    if (goal) {
      plan = {
        goal: goal.slice(0, 120),
        steps: [],
        progress: 'not started',
        updatedAt: ts,
      };
      break;
    }
  }

  const preferences = { ...prev.preferences };
  for (const { key, re } of PREFERENCE_PATTERNS) {
    const value = matchValue(re, combined);
    if (value) {
      preferences[key] = value.slice(0, 40);
    }
  }

  delta.facts = facts;
  if (decisions.length > prev.decisions.length) delta.decisions = decisions.slice(-MEMORY_CAPS.decisions);
  if (plan !== prev.plan) delta.plan = plan;
  if (Object.keys(preferences).length > Object.keys(prev.preferences).length) {
    delta.preferences = Object.fromEntries(
      Object.entries(preferences)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, MEMORY_CAPS.preferences),
    );
  }

  return delta;
};

/** Merge a delta into memory, enforcing caps. Returns a NEW memory object. */
export function applyMemoryDelta(prev: AgentMemory, delta: MemoryDelta): AgentMemory {
  return {
    facts: (delta.facts ?? prev.facts).slice(-MEMORY_CAPS.facts),
    decisions: (delta.decisions ?? prev.decisions).slice(-MEMORY_CAPS.decisions),
    plan: delta.plan !== undefined ? delta.plan : prev.plan,
    preferences: Object.fromEntries(
      Object.entries(delta.preferences ?? prev.preferences)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, MEMORY_CAPS.preferences),
    ),
    updatedAt: new Date().toISOString(),
  };
}

/** Render the memory block injected before each prompt. */
export function seedMemoryBlock(memory: AgentMemory): string {
  const lines: string[] = ['[Memory]'];
  if (memory.facts.length > 0) {
    lines.push('Facts:');
    for (const f of memory.facts) lines.push(`- ${f.key}: ${f.value}`);
  }
  if (memory.decisions.length > 0) {
    lines.push('Decisions:');
    for (const d of memory.decisions.slice(-10)) {
      lines.push(`- ${d.context} -> ${d.choice}${d.reason ? ` (${d.reason})` : ''}`);
    }
  }
  if (memory.plan) {
    lines.push(`Plan: ${memory.plan.goal} [${memory.plan.progress}]`);
  }
  if (Object.keys(memory.preferences).length > 0) {
    lines.push('Preferences:');
    for (const [k, v] of Object.entries(memory.preferences)) lines.push(`- ${k}: ${v}`);
  }
  if (lines.length === 1) return '';
  return lines.join('\n');
}

/** Keyword-matched recall (ports oc-slack `/memory recall <kw>`). */
export function recallMemory(memory: AgentMemory, query: string): string[] {
  const q = query.toLowerCase();
  const hits: string[] = [];
  for (const f of memory.facts) {
    if (f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q)) {
      hits.push(`${f.key}: ${f.value}`);
    }
  }
  for (const d of memory.decisions) {
    if (d.choice.toLowerCase().includes(q) || d.context.toLowerCase().includes(q)) {
      hits.push(`decision: ${d.choice}`);
    }
  }
  return hits;
}

export type MemoryCommand = { type: 'memory' } | { type: 'recall'; query: string } | { type: 'none' };

/** Parse `/memory` and `/memory recall <kw>` chat commands. */
export function parseMemoryCommand(text: string): MemoryCommand {
  const t = text.trim();
  if (/^\/memory\s+recall\s+(.+)$/i.test(t)) {
    const q = t.replace(/^\/memory\s+recall\s+/i, '').trim();
    return { type: 'recall', query: q };
  }
  if (/^\/memory$/i.test(t)) return { type: 'memory' };
  return { type: 'none' };
}

/** Render a readable `/memory` dump for diagnostics. */
export function renderMemory(memory: AgentMemory): string {
  const block = seedMemoryBlock(memory);
  return block === '' ? 'No memory yet.' : block;
}
