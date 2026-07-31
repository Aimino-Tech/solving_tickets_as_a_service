import { describe, expect, it } from 'vitest';
import { detectGoldfish, isTurnGoldfishFree } from '../lib/goldfish-detector.js';

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
