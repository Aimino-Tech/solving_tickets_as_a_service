/**
 * Slack issue reference parser.
 *
 * Parses issue references from Slack message text — supports:
 * - Full GitHub URL: https://github.com/org/repo/issues/42
 * - Short form: org/repo#42
 * - Short form with context: owner/repo#123
 * - Bare number: #42 (uses default repo when no explicit repo provided)
 */

export interface ParsedIssueRef {
  owner: string;
  repo: string;
  issueNumber: number;
  /** The original matched text */
  raw: string;
}

/**
 * Pattern for full GitHub issue URL:
 *   https://github.com/owner/repo/issues/123
 */
const FULL_URL_RE =
  /https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/issues\/(\d+)/g;

/**
 * Pattern for shorthand "owner/repo#123".
 * Must be bounded by word boundaries or start/end of text.
 */
const SHORT_RE = /(?:^|[\s,;])([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)#(\d+)\b/g;

/**
 * Pattern for bare "#123" — an issue number with no repo context.
 */
const BARE_RE = /(?:^|[\s,;([])`?#(\d+)\b/g;

/**
 * Parse all issue references found in the given text.
 *
 * @param text - The Slack message text content.
 * @param defaultOwner - Fallback owner when only a bare issue number is found.
 * @param defaultRepo - Fallback repo when only a bare issue number is found.
 * @returns Deduplicated list of parsed issue references (by issue URL).
 */
export function parseIssueRefs(
  text: string,
  defaultOwner?: string,
  defaultRepo?: string,
): ParsedIssueRef[] {
  const seen = new Set<string>();
  const refs: ParsedIssueRef[] = [];

  // 1. Full URL: https://github.com/owner/repo/issues/123
  let match: RegExpExecArray | null;
  while ((match = FULL_URL_RE.exec(text)) !== null) {
    const owner = match[1];
    const repo = match[2];
    const issueNumber = Number.parseInt(match[3], 10);
    const key = `${owner}/${repo}#${issueNumber}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ owner, repo, issueNumber, raw: match[0] });
    }
  }

  // 2. Short form: owner/repo#123
  while ((match = SHORT_RE.exec(text)) !== null) {
    const owner = match[1];
    const repo = match[2];
    const issueNumber = Number.parseInt(match[3], 10);
    const key = `${owner}/${repo}#${issueNumber}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ owner, repo, issueNumber, raw: match[0].trim() });
    }
  }

  // 3. Bare number: #42 (only if we have defaults)
  if (defaultOwner && defaultRepo) {
    while ((match = BARE_RE.exec(text)) !== null) {
      const issueNumber = Number.parseInt(match[1], 10);
      const key = `${defaultOwner}/${defaultRepo}#${issueNumber}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({
          owner: defaultOwner,
          repo: defaultRepo,
          issueNumber,
          raw: match[0].trim(),
        });
      }
    }
  }

  return refs;
}
