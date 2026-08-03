/**
 * Linear ticket reference extraction for the Slack @syntaro mention handler.
 *
 * AIM-4460: "fix [AIM-1234](https://linear.app/aimino/issue/AIM-1234/...)"
 * or "fix ticket <title>" — extract the Linear ticket identifiers so the
 * handler can confirm each one before dispatching work.
 */

/** Matches Linear-style ticket identifiers like `AIM-1234` (case-insensitive). */
const TICKET_REF_RE = /\bAIM-\d+\b/gi;

/**
 * Extracts Linear ticket identifiers (e.g. `AIM-1234`) from free text.
 *
 * Identifiers are normalized to uppercase and deduplicated while preserving
 * first-seen order. Non-Linear identifiers (e.g. `XYZ-1`) are ignored.
 *
 * @param text - the raw Slack message text
 * @returns the ticket identifiers found, uppercased and deduplicated
 */
export function extractTicketRefs(text: string): string[] {
  const matches = text.match(TICKET_REF_RE) ?? [];
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const match of matches) {
    const normalized = match.toUpperCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      refs.push(normalized);
    }
  }
  return refs;
}
