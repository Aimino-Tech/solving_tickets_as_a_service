import { describe, expect, it } from 'vitest';
import {
  detectGoldfish,
  GOLDFISH_PATTERN_COUNT,
  isTurnGoldfishFree,
} from '../lib/goldfish-detector.js';

interface PatternCase {
  sentence: string;
  expectedReason: string;
  control: string;
}

/**
 * One positive sentence + one clean control sentence per goldfish pattern.
 * The guard test below asserts PATTERN_CASES covers all 22 patterns, so a new
 * pattern without a test case fails CI.
 */
const PATTERN_CASES: PatternCase[] = [
  { sentence: 'What do you mean by that?', expectedReason: 'asks-what-you-mean', control: 'I know what you mean.' },
  { sentence: 'Could you repeat that?', expectedReason: 'asks-re-explain', control: 'I can repeat the details if useful.' },
  { sentence: 'Please repeat the last point.', expectedReason: 'asks-re-explain', control: 'Please find the last point on page three.' },
  { sentence: 'Repeat that.', expectedReason: 'asks-re-explain', control: 'Repeat step three after the deploy.' },
  { sentence: 'Please re-explain the plan.', expectedReason: 'asks-re-explain', control: 'The plan is explained in the README.' },
  { sentence: 'Restate the requirements.', expectedReason: 'asks-re-explain', control: 'The requirements are listed above.' },
  { sentence: 'Say that again.', expectedReason: 'asks-again', control: 'Say that clearly.' },
  { sentence: 'Could you tell me once more?', expectedReason: 'asks-again', control: 'Could you send the updated report?' },
  { sentence: 'Remind me of the deadline.', expectedReason: 'asks-reminder', control: 'I will remind the team tomorrow.' },
  { sentence: 'Do you remember what we discussed?', expectedReason: 'asks-reminder', control: 'Do you think the timeline is realistic?' },
  { sentence: "I don't recall the details.", expectedReason: 'lost-memory', control: "I don't doubt the plan." },
  { sentence: 'I lost track of the deadline.', expectedReason: 'lost-memory', control: 'I kept track of the deadline.' },
  { sentence: 'What were we doing?', expectedReason: 'lost-thread', control: 'What were the numbers?' },
  { sentence: 'What was the context again?', expectedReason: 'lost-context', control: 'What is the next step?' },
  { sentence: 'I have no context here.', expectedReason: 'no-context', control: 'I have enough context to proceed.' },
  { sentence: 'I lost the thread of our conversation.', expectedReason: 'lost-memory', control: 'The thread pool was exhausted.' },
  { sentence: "I don't have any notes from that meeting.", expectedReason: 'no-context', control: 'I have the notes from that meeting.' },
  { sentence: 'Let us start over.', expectedReason: 'restart-request', control: 'Let us start the migration.' },
  { sentence: 'Can we go from the top?', expectedReason: 'restart-request', control: 'We started from the bottom.' },
  { sentence: 'Start from scratch.', expectedReason: 'restart-request', control: 'Start from the existing template.' },
  { sentence: 'Can you tell me what we were doing?', expectedReason: 'lost-thread', control: 'Can you tell me when the meeting starts?' },
  { sentence: 'What were we discussing?', expectedReason: 'lost-thread', control: 'What was discussed at the sync?' },
];

describe('detectGoldfish', () => {
  it('flags replies that ask the user to re-explain', () => {
    const result = detectGoldfish('Sorry, I lost the context. Could you explain from the start again?');
    expect(result.isGoldfish).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('flags "what do you mean"', () => {
    expect(detectGoldfish('What do you mean by that?').isGoldfish).toBe(true);
  });

  it('flags "remind me"', () => {
    expect(detectGoldfish('Remind me what we discussed.').isGoldfish).toBe(true);
  });

  it('flags memory-loss statements', () => {
    const result = detectGoldfish("I don't remember what we were talking about.");
    expect(result.isGoldfish).toBe(true);
    expect(result.reasons).toContain('lost-memory');
  });

  it('flags empty replies', () => {
    const result = detectGoldfish('   ');
    expect(result.isGoldfish).toBe(true);
    expect(result.reasons).toContain('empty-reply');
  });

  it('accepts replies that reference earlier facts', () => {
    expect(detectGoldfish("Aurora's launch deadline is end of October.").isGoldfish).toBe(false);
  });

  it('accepts a normal summary reply', () => {
    const result = detectGoldfish(
      'Migrate auth from sessions to JWT: 15-minute expiry, SSO preserved, zero-downtime cutover within two weeks.',
    );
    expect(result.isGoldfish).toBe(false);
  });

  it('collects multiple goldfish reasons', () => {
    const result = detectGoldfish("I don't remember the context. What were we talking about?");
    expect(result.isGoldfish).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(1);
  });
});

describe('every goldfish pattern (22/22)', () => {
  it.each(PATTERN_CASES)('$expectedReason: "$sentence" is flagged', ({ sentence, expectedReason }) => {
    const result = detectGoldfish(sentence);
    expect(result.isGoldfish).toBe(true);
    expect(result.reasons).toContain(expectedReason);
  });

  it.each(PATTERN_CASES)('$expectedReason: control "$control" stays clean', ({ control }) => {
    const result = detectGoldfish(control);
    expect(result.isGoldfish).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});

describe('goldfish pattern-count guard', () => {
  it('stays at 22 patterns, one positive test case each', () => {
    expect(GOLDFISH_PATTERN_COUNT).toBe(22);
    expect(PATTERN_CASES).toHaveLength(GOLDFISH_PATTERN_COUNT);
  });

  it('still covers every reason group', () => {
    const covered = new Set(PATTERN_CASES.map((c) => c.expectedReason));
    expect([...covered].sort()).toEqual([
      'asks-again',
      'asks-re-explain',
      'asks-reminder',
      'asks-what-you-mean',
      'lost-context',
      'lost-memory',
      'lost-thread',
      'no-context',
      'restart-request',
    ]);
  });
});

describe('isTurnGoldfishFree', () => {
  it('never checks seeding turns', () => {
    expect(isTurnGoldfishFree('', 2, 3)).toBe(true);
  });

  it('checks turns after the seeding prefix', () => {
    expect(isTurnGoldfishFree('What do you mean?', 5, 3)).toBe(false);
  });

  it('accepts clean replies after the seeding prefix', () => {
    expect(isTurnGoldfishFree('FastAPI.', 5, 3)).toBe(true);
  });
});
