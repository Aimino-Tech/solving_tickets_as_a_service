import { describe, expect, it } from 'vitest';
import { detectGoldfish, isCleanReply, GOLDFISH_PATTERNS } from './goldfish-detector.js';

const KNOWN_GOLDFISH_LINES = [
  'Could you repeat that? I do not have the context from our earlier conversation.',
  'I do not remember — can you remind me what we discussed before?',
  'I do not have that context. Could you re-explain your project setup?',
  'What did you mean by that earlier? I lost track of the previous turns.',
];

const CLEAN_ANSWERS = [
  'Based on what we established earlier — project: invoice-service; language: TypeScript.',
  'The storage engine is PostgreSQL, as we decided.',
  'Per our plan, the API ships Friday.',
  'I do not see that referenced in our notes, but I remember 2 fact(s) we established.',
  'I am not sure — I do not have any recorded context yet.',
  'Yes, the Friday delivery is still on track.',
  'We picked cursor-based pagination for the list endpoint.',
];

describe('goldfish-detector', () => {
  it('catches every known goldfish baseline line', () => {
    for (const line of KNOWN_GOLDFISH_LINES) {
      const d = detectGoldfish(line);
      expect(d.goldfish, `should catch: ${line}`).toBe(true);
      expect(d.offendingLines).toContain(line);
      expect(d.matches.length).toBeGreaterThan(0);
    }
  });

  it('returns offending lines and match ids', () => {
    const d = detectGoldfish('Could you repeat that? I lost track of what we said.');
    expect(d.goldfish).toBe(true);
    expect(d.offendingLines.length).toBeGreaterThan(0);
    expect(d.matches.some((m) => /repeat|lost-track/.test(m))).toBe(true);
  });

  it('passes clean answers that use context correctly', () => {
    for (const line of CLEAN_ANSWERS) {
      const d = detectGoldfish(line);
      expect(d.goldfish, `should be clean: ${line}`).toBe(false);
      expect(d.matches).toEqual([]);
      expect(d.offendingLines).toEqual([]);
      expect(isCleanReply(line)).toBe(true);
    }
  });

  it('detects generic re-explanation requests', () => {
    const goldfishVariants = [
      'Please repeat what you said.',
      'Can you restate the project requirements?',
      'What did you mean by that?',
      'Could you say that again?',
      'Start over — I have lost track.',
    ];
    for (const line of goldfishVariants) {
      expect(detectGoldfish(line).goldfish, `should catch: ${line}`).toBe(true);
    }
  });

  it('has non-trivial detector coverage (patterns defined)', () => {
    expect(GOLDFISH_PATTERNS.length).toBeGreaterThanOrEqual(10);
  });
});
