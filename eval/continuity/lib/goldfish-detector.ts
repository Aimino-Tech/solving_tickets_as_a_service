/**
 * Goldfish detector (AIM-4445).
 *
 * Detects whether an assistant reply "talks to a gold fish": i.e. it asks
 * the user to re-explain or re-provide context that was already established
 * earlier in the conversation. A memory-less agent fails continuity exactly
 * this way.
 *
 * The detector inspects ASSISTANT replies only, never user messages. An
 * empty reply is treated as goldfish (the bot produced no usable answer).
 */
export interface GoldfishDetection {
  isGoldfish: boolean;
  reasons: string[];
}

interface GoldfishPattern {
  pattern: RegExp;
  reason: string;
}

const GOLDFISH_PATTERNS: GoldfishPattern[] = [
  { pattern: /\b(what do you mean|what did you mean)\b/i, reason: 'asks-what-you-mean' },
  { pattern: /\b(can|could) you (repeat|rephrase|clarify|explain)\b/i, reason: 'asks-re-explain' },
  { pattern: /\bplease repeat\b/i, reason: 'asks-re-explain' },
  { pattern: /\brepeat that\b/i, reason: 'asks-re-explain' },
  { pattern: /\b(please )?re-?explain\b/i, reason: 'asks-re-explain' },
  { pattern: /\b(re-?state|restate)\b/i, reason: 'asks-re-explain' },
  { pattern: /\b(say|explain) (that )?again\b/i, reason: 'asks-again' },
  { pattern: /\bcould you (explain|tell me) (again|once more)\b/i, reason: 'asks-again' },
  { pattern: /\b(remind me|remind us|can you remind)\b/i, reason: 'asks-reminder' },
  { pattern: /\bdo you remember\b/i, reason: 'asks-reminder' },
  { pattern: /\b(i don'?t|i do not|we don'?t) (remember|recall)\b/i, reason: 'lost-memory' },
  { pattern: /\bi lost track of\b/i, reason: 'lost-memory' },
  { pattern: /\b(what were|what are) we (talking|discussing|doing|working on)\b/i, reason: 'lost-thread' },
  { pattern: /\b(what is|what was) the (context|conversation)\b/i, reason: 'lost-context' },
  { pattern: /\b(i have|we have|i lost) no? (context|memory|idea)\b/i, reason: 'no-context' },
  { pattern: /\b(i lost|we lost|i have lost) (the )?(context|memory|idea|thread)\b/i, reason: 'lost-memory' },
  { pattern: /\b(i don'?t|i do not) (have|possess) (any|the) (context|memory|history|notes)\b/i, reason: 'no-context' },
  { pattern: /\b(start|begin) (from |all )?(the )?over\b/i, reason: 'restart-request' },
  { pattern: /\bfrom the (very )?(start|top|beginning)\b/i, reason: 'restart-request' },
  { pattern: /\b(start|begin) from scratch\b/i, reason: 'restart-request' },
  { pattern: /\bcan you tell me what we (were|are) (doing|working on)\b/i, reason: 'lost-thread' },
  { pattern: /\bwhat were we (discussing|talking about|working on)\b/i, reason: 'lost-thread' },
];

/** Number of goldfish patterns. Guarded by tests so every pattern stays covered. */
export const GOLDFISH_PATTERN_COUNT: number = GOLDFISH_PATTERNS.length;

/** Detect goldfish behavior in an assistant reply. Pure function. */
export function detectGoldfish(reply: string): GoldfishDetection {
  const trimmed = reply.trim();
  if (trimmed.length === 0) {
    return { isGoldfish: true, reasons: ['empty-reply'] };
  }
  const reasons: string[] = [];
  for (const { pattern, reason } of GOLDFISH_PATTERNS) {
    if (pattern.test(trimmed)) {
      reasons.push(reason);
    }
  }
  return { isGoldfish: reasons.length > 0, reasons };
}

/**
 * Returns true when an assistant reply for the given turn is acceptable:
 * it is non-empty and carries no goldfish signal. Turns within the seeding
 * prefix (turn <= seedTurns) are never checked.
 */
export function isTurnGoldfishFree(reply: string, turn: number, seedTurns: number): boolean {
  if (turn <= seedTurns) {
    return true;
  }
  return !detectGoldfish(reply).isGoldfish;
}
