/**
 * AIM-4445 — Goldfish detector.
 *
 * A "goldfish" assistant has no memory: when the user references something
 * established earlier in the conversation, it asks the user to repeat, remind,
 * or re-explain it. This detector scans assistant replies for re-explanation
 * requests using regex + keyword heuristics, and returns the offending lines
 * so reports can point at exactly what failed.
 *
 * It must:
 *  - catch the four known goldfish baselines used by GoldfishBotExecutor
 *  - catch generic re-explanation requests ("could you repeat", "remind me",
 *    "re-explain", "what did you mean by", ...)
 *  - NOT flag honest answers that simply admit lack of a specific fact
 *    ("I do not have any recorded context yet") — only requests for the user
 *    to re-provide context.
 */

export interface GoldfishDetection {
  goldfish: boolean;
  /** Detector pattern ids that fired. */
  matches: string[];
  /** The offending assistant lines (unique). */
  offendingLines: string[];
}

export interface GoldfishPattern {
  id: string;
  re: RegExp;
}

/** Patterns that indicate the assistant asked the user to re-provide context. */
export const GOLDFISH_PATTERNS: GoldfishPattern[] = [
  { id: 'repeat-could', re: /\bcould you (please )?repeat\b/i },
  { id: 'repeat-can', re: /\bcan you (please )?repeat\b/i },
  { id: 'repeat-please', re: /\bplease repeat\b/i },
  { id: 'repeat-that', re: /\brepeat that\b/i },
  { id: 'remind-me', re: /\bremind me\b/i },
  { id: 'can-you-remind', re: /\bcan you remind\b/i },
  { id: 'what-did-you-mean', re: /\bwhat did you mean by\b/i },
  { id: 're-explain', re: /\bre-?explain\b/i },
  { id: 're-state', re: /\bre-?state\b/i },
  { id: 'restate', re: /\brestate\b/i },
  { id: 'say-again', re: /\bsay that again\b/i },
  { id: 'do-you-remember', re: /\bdo you remember\b/i },
  { id: 'lost-track', re: /\bi lost track of\b/i },
  { id: 'no-context-the', re: /\bi (don'?t|do not) have (the|that) (context|memory|history|notes)\b/i },
  { id: 'no-remember', re: /\bi (don'?t|do not) (remember|recall)\b/i },
  { id: 'start-over', re: /\bstart (over|from scratch)\b/i },
  { id: 'no-context-any', re: /\bi (don'?t|do not) (have|possess) (any|the) (context|memory) (of|about|for)\b/i },
  { id: 'what-were-we', re: /\bwhat were we (discussing|talking about|doing)\b/i },
];

/** Scan a single assistant reply for goldfish signals. */
export function detectGoldfish(reply: string): GoldfishDetection {
  const matches: string[] = [];
  const offendingLines: string[] = [];

  const lines = reply.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const lineHits = GOLDFISH_PATTERNS.filter((p) => p.re.test(line)).map((p) => p.id);
    if (lineHits.length > 0) {
      offendingLines.push(line);
      for (const id of lineHits) if (!matches.includes(id)) matches.push(id);
    }
  }

  return { goldfish: offendingLines.length > 0, matches, offendingLines };
}

/** Convenience: true when the reply is clean (not goldfish). */
export function isCleanReply(reply: string): boolean {
  return !detectGoldfish(reply).goldfish;
}
