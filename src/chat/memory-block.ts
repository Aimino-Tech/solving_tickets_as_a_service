/**
 * Local memory helpers for the chat stack (AIM-4442).
 *
 * The durable memory types live in `src/agent/memory/types.ts` (SessionMemory).
 * This module provides the small conveniences the pod/session-store need:
 * an empty memory seed, a prompt block renderer, a delta type for extractors
 * and the merge function that applies a delta back onto a SessionMemory.
 */

import {
  MEMORY_LIMITS,
  type MemoryDecision,
  type MemoryFact,
  type MemoryPreference,
  type SessionMemory,
} from '../agent/memory/types.js';

/** An empty, seedable session memory. */
export function emptySessionMemory(): SessionMemory {
  return { facts: [], decisions: [], preferences: [] };
}

/** Minimal shapes an extractor returns; `applyMemoryDelta` fills the rest. */
export interface MemoryFactInput {
  key: string;
  content: string;
  source?: 'user' | 'assistant' | 'auto';
  tags?: string[];
}

export interface MemoryDecisionInput {
  key: string;
  content: string;
  rationale?: string;
}

export interface MemoryPreferenceInput {
  key: string;
  content: string;
}

export interface MemoryPlanInput {
  summary: string;
  steps: string[];
}

/** A partial memory change produced by a MemoryExtractor after a turn. */
export interface MemoryDelta {
  facts?: MemoryFactInput[];
  decisions?: MemoryDecisionInput[];
  /** Set to replace the plan, or null to clear it. */
  plan?: MemoryPlanInput | null;
  preferences?: MemoryPreferenceInput[];
}

/** Extracts durable memory from a completed turn. */
export type MemoryExtractor = (prev: SessionMemory, userText: string, assistantText: string) => MemoryDelta;

/** No-op extractor: keeps the memory as it is. */
export function defaultExtractor(): MemoryDelta {
  return {};
}

function toFact(input: MemoryFactInput, instance: string, now: string): MemoryFact {
  return {
    key: input.key,
    content: input.content,
    instance,
    source: input.source ?? 'auto',
    tags: input.tags ?? [],
    accessCount: 0,
    createdAt: now,
    lastAccessedAt: now,
  };
}

function toDecision(input: MemoryDecisionInput, instance: string, now: string): MemoryDecision {
  return {
    key: input.key,
    content: input.content,
    instance,
    rationale: input.rationale,
    createdAt: now,
    lastAccessedAt: now,
  };
}

function toPreference(input: MemoryPreferenceInput, instance: string, now: string): MemoryPreference {
  return {
    key: input.key,
    content: input.content,
    instance,
    createdAt: now,
    lastAccessedAt: now,
  };
}

/**
 * Merge a delta onto the previous memory, replacing duplicate keys and
 * capping each collection at MEMORY_LIMITS.
 */
export function applyMemoryDelta(
  prev: SessionMemory,
  delta: MemoryDelta,
  instance = 'chat',
  now = new Date().toISOString(),
): SessionMemory {
  const facts = [...prev.facts];
  for (const input of delta.facts ?? []) {
    const existing = facts.findIndex((f) => f.key === input.key);
    const fact = toFact(input, instance, now);
    if (existing >= 0) facts[existing] = fact;
    else facts.push(fact);
  }

  const decisions = [...prev.decisions];
  for (const input of delta.decisions ?? []) {
    const existing = decisions.findIndex((d) => d.key === input.key);
    const decision = toDecision(input, instance, now);
    if (existing >= 0) decisions[existing] = decision;
    else decisions.push(decision);
  }

  const preferences = [...prev.preferences];
  for (const input of delta.preferences ?? []) {
    const existing = preferences.findIndex((p) => p.key === input.key);
    const preference = toPreference(input, instance, now);
    if (existing >= 0) preferences[existing] = preference;
    else preferences.push(preference);
  }

  const plan = delta.plan === null ? undefined : delta.plan ? { ...delta.plan, updatedAt: now } : prev.plan;

  return {
    facts: facts.slice(-MEMORY_LIMITS.facts),
    decisions: decisions.slice(-MEMORY_LIMITS.decisions),
    ...(plan ? { plan } : {}),
    preferences: preferences.slice(-MEMORY_LIMITS.preferences),
  };
}

/**
 * Render the curated memory as the prompt block seeded before each turn,
 * mirroring `renderMemoryContext` in src/agent/memory/memory-context.ts.
 * Empty sections are skipped; an empty memory renders as an empty string.
 */
export function renderSessionMemoryBlock(memory: SessionMemory): string {
  const blocks: string[] = [];

  if (memory.facts.length > 0) {
    blocks.push(`[Known Facts]\n${memory.facts.map((f) => `- ${f.key}: ${f.content}`).join('\n')}`);
  }

  if (memory.decisions.length > 0) {
    blocks.push(`[Decisions]\n${memory.decisions.map((d) => `- ${d.content}`).join('\n')}`);
  }

  if (memory.plan) {
    const steps = memory.plan.steps.length > 0 ? memory.plan.steps.map((s) => `  ${s}`).join('\n') : '(no steps)';
    blocks.push(`[Current Plan]\n${memory.plan.summary}\n${steps}`);
  }

  if (memory.preferences.length > 0) {
    blocks.push(`[Preferences]\n${memory.preferences.map((p) => `- ${p.content}`).join('\n')}`);
  }

  return blocks.join('\n\n');
}
