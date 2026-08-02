import { describe, expect, it } from 'vitest';

import { SLACK_TEXT_LIMIT, truncateForSlack } from '../../../channels/slack/truncate.js';

describe('truncateForSlack', () => {
  it('returns short text unchanged', () => {
    const text = 'hi';
    expect(truncateForSlack(text)).toBe(text);
  });

  it('returns text at exactly the byte limit unchanged', () => {
    const text = 'a'.repeat(SLACK_TEXT_LIMIT);
    expect(Buffer.byteLength(text, 'utf8')).toBe(SLACK_TEXT_LIMIT);
    expect(truncateForSlack(text)).toBe(text);
  });

  it('truncates text over the byte limit and appends an ellipsis', () => {
    const text = 'a'.repeat(SLACK_TEXT_LIMIT + 1);
    const result = truncateForSlack(text);
    expect(result.endsWith('\u2026')).toBe(true);
    // All-ASCII prefix keeps the full limit, ellipsis appended on top (limit + 3 bytes total).
    expect(result).toBe(`${'a'.repeat(SLACK_TEXT_LIMIT)}\u2026`);
  });

  it('never cuts through a multibyte character', () => {
    // Each emoji is 4 UTF-8 bytes. One more than the limit straddles the boundary.
    const emoji = '\u{1F600}';
    const count = Math.floor(SLACK_TEXT_LIMIT / 4) + 1;
    const text = emoji.repeat(count);
    const result = truncateForSlack(text);

    expect(result.endsWith('\u2026')).toBe(true);
    expect(result.includes('\uFFFD')).toBe(false);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(
      SLACK_TEXT_LIMIT + Buffer.byteLength('\u2026', 'utf8'),
    );
  });

  it('truncated result is valid UTF-8 and within the byte limit', () => {
    const text = 'a\u00E9'.repeat(SLACK_TEXT_LIMIT); // é is 2 UTF-8 bytes
    const result = truncateForSlack(text);

    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(
      SLACK_TEXT_LIMIT + Buffer.byteLength('\u2026', 'utf8'),
    );
    expect(() => Buffer.from(result, 'utf8').toString('utf8')).not.toThrow();
    expect(result.includes('\uFFFD')).toBe(false);
  });
});
