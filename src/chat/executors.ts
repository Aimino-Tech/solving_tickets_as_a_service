/**
 * AIM-4443/4445 — Agent executors for the chat pod.
 *
 * Three executors share the AgentExecutor interface:
 *  - `MemoryBotExecutor` — deterministic "has a memory" bot. It answers
 *    follow-ups by looking up the facts/decisions already in the seeded memory
 *    block. Used by the eval harness to prove the memory stack passes.
 *  - `GoldfishBotExecutor` — deterministic no-memory baseline that always asks
 *    the user to re-explain. The eval harness MUST fail it (proves the
 *    goldfish detector catches goldfish).
 *  - `OpenCodeExecutor` — production adapter that drives the real opencode
 *    session (chat session). Activated only via CHAT_AGENT_MODE=opencode.
 */

import type { AgentExecutor, AgentInput, AgentOutput } from './pod.js';

const GOLDFISH_LINES = [
  'Could you repeat that? I do not have the context from our earlier conversation.',
  'I do not remember — can you remind me what we discussed before?',
  'I do not have that context. Could you re-explain your project setup?',
  'What did you mean by that earlier? I lost track of the previous turns.',
];

/**
 * Parse a `seedMemoryBlock` output into a flat key → value map.
 *
 * The memory block has four sections:
 *   Facts:       - key: value
 *   Decisions:   - context -> choice (reason)
 *   Plan:        Plan: goal [progress]
 *   Preferences: - key: value
 *
 * Every section folds into the same map so a follow-up that references a
 * decision or the active plan is answered from memory just like a fact.
 */
export function parseMemoryBlock(block: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!block) return map;

  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('[') || /^(Facts|Decisions|Preferences):$/i.test(trimmed)) continue;

    const planMatch = /^Plan:\s*(.+?)(?:\s*\[.*\])?$/.exec(trimmed);
    if (planMatch) {
      map.set('plan', planMatch[1].trim());
      continue;
    }

    const decisionMatch = /^[-*]\s*(.+?)\s*->\s*(.+?)(?:\s*\(.*\))?$/.exec(trimmed);
    if (decisionMatch) {
      map.set(`decision: ${decisionMatch[1].trim()}`, decisionMatch[2].trim());
      continue;
    }

    const pairMatch = /^[-*]\s+(.+?):\s(.+)$/.exec(trimmed);
    if (pairMatch) map.set(pairMatch[1].trim().toLowerCase(), pairMatch[2].trim());
  }
  return map;
}

const STOPWORDS = new Set([
  'this',
  'that',
  'with',
  'from',
  'have',
  'been',
  'were',
  'they',
  'them',
  'when',
  'what',
  'will',
  'should',
  'would',
  'could',
  'there',
  'their',
  'about',
  'after',
  'before',
  'because',
  'being',
  'into',
  'over',
  'then',
  'also',
  'just',
  'does',
  'still',
  'make',
  'made',
]);

function significantTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

/**
 * Match when the user text references a fact: full key/value substring, or a
 * significant token (>=4 alphanumeric chars) of the key/value. Token matching
 * lets follow-ups reference facts partially ("friday", "storage") — the whole
 * point of a memory-equipped agent.
 */
export function findReferencedFacts(
  userText: string,
  facts: Map<string, string>,
): Array<{ key: string; value: string }> {
  const lower = userText.toLowerCase();
  const userTokens = new Set(significantTokens(userText));
  const hits: Array<{ key: string; value: string }> = [];
  for (const [key, value] of facts) {
    if (lower.includes(key.toLowerCase()) || lower.includes(value.toLowerCase())) {
      hits.push({ key, value });
      continue;
    }
    if (significantTokens(`${key} ${value}`).some((t) => userTokens.has(t))) {
      hits.push({ key, value });
    }
  }
  return hits;
}

/** Deterministic memory-equipped bot: answers using only the seeded memory. */
export class MemoryBotExecutor implements AgentExecutor {
  readonly name = 'memory';

  async run(input: AgentInput): Promise<AgentOutput> {
    const facts = parseMemoryBlock(input.memoryBlock);
    const hits = findReferencedFacts(input.userText, facts);
    if (hits.length > 0) {
      const parts = hits.map((h) => `${h.key}: ${h.value}`);
      return { reply: `Based on what we established earlier — ${parts.join('; ')}.` };
    }
    if (facts.size === 0) {
      return { reply: 'I am not sure — I do not have any recorded context yet.' };
    }
    return { reply: `I do not see that referenced in our notes, but I remember ${facts.size} fact(s) we established.` };
  }
}

/** Deterministic no-memory baseline: always asks the user to re-explain. */
export class GoldfishBotExecutor implements AgentExecutor {
  readonly name = 'goldfish';

  async run(): Promise<AgentOutput> {
    const line = GOLDFISH_LINES[Math.floor(Math.random() * GOLDFISH_LINES.length)];
    return { reply: line };
  }
}

/**
 * Production adapter — drives the real opencode chat session inside the pod.
 * Uses `@opencode-ai/sdk` when available (promptWithPolling semantics: issue
 * the prompt, then poll until `finish === 'stop'`). Intended to run inside the
 * pod image, not in unit tests.
 */
export class OpenCodeExecutor implements AgentExecutor {
  readonly name = 'opencode';
  private readonly sessionUrl: string;

  constructor(sessionUrl = 'http://127.0.0.1:4096') {
    this.sessionUrl = sessionUrl;
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    // Prompt with memory seeded into the system/user context.
    const prompt = [
      input.memoryBlock ? `[Agent Memory — use this, do not ask the user to re-explain]\n${input.memoryBlock}` : '',
      input.recentTranscript.length > 0
        ? `[Recent Conversation History]\n${input.recentTranscript.map((t) => `${t.role}: ${t.text}`).join('\n')}`
        : '',
      `[User] ${input.userText}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const { createSession, promptWithPolling } = await import('@opencode-ai/sdk');
    const client = createSession({ url: this.sessionUrl });
    // Reuse the session on this pod for continuity.
    await client.session.create({ title: `chat:${input.sessionId}` }).catch(() => undefined);
    const result = await promptWithPolling(client, {
      sessionId: input.sessionId,
      prompt,
      onResponse: () => undefined,
    });
    return { reply: result.text ?? '' };
  }
}

export function createExecutor(mode: 'memory' | 'goldfish' | 'opencode'): AgentExecutor {
  switch (mode) {
    case 'goldfish':
      return new GoldfishBotExecutor();
    case 'opencode':
      return new OpenCodeExecutor();
    default:
      return new MemoryBotExecutor();
  }
}
