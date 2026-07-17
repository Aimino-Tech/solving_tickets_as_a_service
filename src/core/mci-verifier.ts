/**
 * MCI Verifier — Message-Code Inconsistency detection.
 *
 * Compares a PR description (message) against the git diff to determine how
 * well the description matches the actual changes. Uses simple heuristics
 * (keyword matching, file path extraction) rather than LLM calls.
 *
 * Returns a score (0–100) and a list of flagged inconsistencies.
 *
 * ── Scoring ──────────────────────────────────────────────────────────────
 * - File path overlap (60 pts): fraction of files mentioned in the
 *   description that actually appear in the diff.
 * - Keyword overlap (40 pts): fraction of meaningful keywords from the
 *   description that appear in the diff text.
 *
 * A score below the threshold (default: 40) is considered a MCI failure.
 */

export interface MciverificationResult {
  /** Overall consistency score (0–100). */
  score: number;
  /** Whether the score is above the configured threshold. */
  passed: boolean;
  /** Phantom changes — claims in the description not reflected in the diff. */
  phantomChanges: string[];
  /** Details explaining the scoring breakdown. */
  details: string[];
}

const DEFAULT_THRESHOLD = 40;

/**
 * Common English words that carry no semantic meaning about a change.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'and', 'but', 'or', 'if', 'because', 'about',
  'up', 'just', 'also', 'now', 'even', 'still', 'already', 'yet', 'any',
]);

/**
 * Extract file paths from a git diff.
 */
function extractFilePathsFromDiff(diff: string): string[] {
  const paths: string[] = [];
  // Lines like: diff --git a/path/to/file.ts b/path/to/file.ts
  const diffGitRe = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let match: RegExpExecArray | null;
  while ((match = diffGitRe.exec(diff)) !== null) {
    // Both sides should point to the same file; use the first
    const fileA = match[1];
    const fileB = match[2];
    // Pick the one that is not /dev/null
    const path = fileA === '/dev/null' ? fileB : fileA === '/dev/null' ? fileA : fileA;
    if (path !== '/dev/null') {
      paths.push(path);
    }
  }

  // Fallback: lines beginning with +++ b/ or --- a/ (for the first hunk)
  if (paths.length === 0) {
    const plusRe = /^\+\+\+ b\/(.+)$/gm;
    while ((match = plusRe.exec(diff)) !== null) {
      const path = match[1];
      if (path && path !== '/dev/null') {
        paths.push(path);
      }
    }
  }

  return [...new Set(paths)];
}

/**
 * Extract file path-like mentions from a description (PR body / issue text).
 */
function extractFilePathsFromDescription(description: string): string[] {
  const paths: string[] = [];

  // Match backtick-wrapped paths like `src/file.ts`, `path/to/file.js`, `.env`
  const backtickRe = /`([^\s`]+\.(?:\w+))`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRe.exec(description)) !== null) {
    const path = match[1];
    if (
      path &&
      !path.startsWith('http') &&
      !path.startsWith('#') &&
      (path.includes('/') || path.startsWith('.'))
    ) {
      paths.push(path);
    }
  }

  // Match file references in markdown links like [file](path/to/file.ts)
  const mdLinkRe = /\[([^\]]+)\]\(([^)]+\.\w+)\)/g;
  while ((match = mdLinkRe.exec(description)) !== null) {
    const url = match[2];
    if (url && !url.startsWith('http') && !url.startsWith('#') && url.includes('.')) {
      paths.push(url);
    }
  }

  return [...new Set(paths)];
}

/**
 * Extract meaningful keywords from text (strips stop words, short tokens, and
 * markdown syntax).
 */
function extractKeywords(text: string): string[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')   // Remove code blocks
    .replace(/`[^`]+`/g, '')          // Remove inline code
    .replace(/[#*_~>[\]()|]/g, ' ')   // Replace markdown syntax with spaces
    .replace(/\b\w{1,2}\b/g, ' ')     // Remove 1-2 char tokens
    .replace(/\d+[\w.]*/g, ' ')       // Remove numeric tokens
    .toLowerCase();

  const tokens = cleaned.split(/[\s,;:.!?]+/).filter(Boolean);
  const seen = new Set<string>();

  return tokens.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return t.length >= 3 && !STOP_WORDS.has(t);
  });
}

/**
 * Compute the fraction of description keywords that appear in the diff.
 */
function computeKeywordOverlap(descriptionKeywords: string[], diff: string): number {
  if (descriptionKeywords.length === 0) return 1; // No keywords = no penalty
  const diffLower = diff.toLowerCase();

  const found = descriptionKeywords.filter((kw) => diffLower.includes(kw));
  return found.length / descriptionKeywords.length;
}

/**
 * Verify PR description consistency against the git diff.
 *
 * @param description  The PR description or issue body.
 * @param diff         The git diff (unified format) of the fix.
 * @param threshold    Minimum acceptable score (default: 40).
 */
export function verifyMciconsistency(
  description: string,
  diff: string,
  threshold: number = DEFAULT_THRESHOLD,
): MciverificationResult {
  const details: string[] = [];
  const phantomChanges: string[] = [];

  // ── 1. File path overlap (0–60 pts) ──────────────────────────────────
  const descFiles = extractFilePathsFromDescription(description);
  const diffFiles = extractFilePathsFromDiff(diff);
  const fileScore: number =
    descFiles.length > 0
      ? (descFiles.filter((f) => diffFiles.some((df) => df.includes(f) || f.includes(df))).length /
          descFiles.length) *
        60
      : 60; // No files in description = no penalty (description may be prose-only)

  if (descFiles.length > 0) {
    // Find phantom files — those mentioned in description but absent from diff
    for (const f of descFiles) {
      const found = diffFiles.some((df) => df.includes(f) || f.includes(df));
      if (!found) {
        phantomChanges.push(f);
      }
    }

    details.push(
      `File path overlap: files in description=${descFiles.length}, files in diff=${diffFiles.length}, phantom=${phantomChanges.length}`,
    );
  } else {
    details.push('No file paths found in description — file score defaults to max');
  }

  // ── 2. Keyword overlap (0–40 pts) ────────────────────────────────────
  const keywords = extractKeywords(description);
  const keywordRatio = computeKeywordOverlap(keywords, diff);
  const keywordScore = keywordRatio * 40;

  details.push(
    `Keyword overlap: ${keywords.length} keywords extracted, ${Math.round(keywordRatio * 100)}% matched in diff`,
  );

  // ── 3. Composite score ───────────────────────────────────────────────
  const score = Math.round(fileScore + keywordScore);
  const clampedScore = Math.max(0, Math.min(100, score));

  details.push(`Composite score: ${clampedScore}/100 (file=${Math.round(fileScore)}, keyword=${Math.round(keywordScore)})`);

  return {
    score: clampedScore,
    passed: clampedScore >= threshold,
    phantomChanges,
    details,
  };
}
