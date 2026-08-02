/**
 * AIM-4465 — Byte-safe Slack text truncation.
 *
 * Slack rejects chat.postMessage / chat.update payloads whose text exceeds the
 * API limit (4000 chars); we keep a safety margin at `SLACK_TEXT_LIMIT` (3000).
 * A naive byte slice can cut mid-codepoint, producing invalid UTF-8 (or, in
 * Elixir's binary_part, an ArgumentError) that silently kills replies. This
 * module truncates on the largest valid UTF-8 prefix — never crashes, and the
 * result is always valid UTF-8.
 */

/** Safety-margin limit for Slack message text (Slack's hard API limit is 4000). */
export const SLACK_TEXT_LIMIT = 3000;

const ELLIPSIS = '\u2026'; // "…" — 3 bytes in UTF-8

/**
 * Truncate `text` to at most `limit` UTF-8 bytes, appending "…" when the text
 * is cut. Text at or under the limit is returned unchanged.
 *
 * The cut falls on a UTF-8 codepoint boundary: when byte `limit` lands inside
 * a multi-byte sequence, we back up to the start of that sequence so the
 * returned prefix is always valid UTF-8 (no lone surrogates, no truncated
 * sequences). Guarantees: never throws; `Buffer.byteLength(prefix, 'utf8')`
 * ≤ limit; the full result is valid UTF-8.
 */
export function truncateForSlack(text: string, limit: number = SLACK_TEXT_LIMIT): string {
  if (Buffer.byteLength(text, 'utf8') <= limit) return text;

  const buf = Buffer.from(text, 'utf8');
  let end = limit;

  // A valid cut point is a position whose byte is NOT a continuation byte
  // (10xxxxxx): ASCII bytes (0xxxxxxx) and multi-byte lead bytes (11xxxxxx)
  // both start a fresh codepoint. Walk back from the limit until we find one.
  while (end > 0 && buf[end] !== undefined && (buf[end] & 0xc0) === 0x80) {
    end--;
  }

  return buf.subarray(0, end).toString('utf8') + ELLIPSIS;
}
