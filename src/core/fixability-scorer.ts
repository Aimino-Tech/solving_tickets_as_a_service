/**
 * FixabilityScorer — Estimates how fixable a GitHub issue is without
 * running the full agent pipeline.
 *
 * Used by the preview API to give users a sense of which issues SYNTARO
 * can handle and why, before they install or subscribe.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FixabilityScore {
  issueNumber: number;
  /** 0–100 where 100 = most fixable */
  score: number;
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable justification for the score */
  reason: string;
  /** Estimated wall-clock time for the fix, e.g. "5–15 min" */
  estimatedFixTime: string;
}

export interface IssueData {
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Keywords that signal a complex, multi-file, or risky change. */
const COMPLEXITY_KEYWORDS = [
  'migration',
  'refactor',
  'upgrade',
  'redesign',
  'overhaul',
  'restructure',
];

/** Patterns that make an issue sound vague or underspecified. */
const VAGUE_PATTERNS = [
  /\b(something|somewhere|maybe|perhaps|not sure)\b/i,
  /^(improve|look into|investigate)\b/i,
];

/** Labels that suggest a contained, well-scoped fix. */
const GOOD_LABELS = new Set([
  'bug',
  'bugfix',
  'good first issue',
  'easy',
  'small',
]);

/** Labels that suggest a complex change. */
const COMPLEX_LABELS = new Set([
  'enhancement',
  'feature',
  'epic',
  'refactor',
]);

// ---------------------------------------------------------------------------
// FixabilityScorer
// ---------------------------------------------------------------------------

export class FixabilityScorer {
  /**
   * Score a single issue for fixability.
   */
  score(issue: IssueData): FixabilityScore {
    let score = 50; // neutral baseline
    const reasons: string[] = [];

    // ── Boosters ────────────────────────────────────────────────────────

    // Good labels (bug, good first issue, etc.)
    const hasGoodLabel = issue.labels.some((l) => GOOD_LABELS.has(l.toLowerCase()));
    if (hasGoodLabel) {
      score += 15;
      reasons.push('Well-scoped label');
    }

    // Title and body present and non-trivial
    const titleLen = issue.title.trim().length;
    if (titleLen >= 10) {
      score += 5;
      reasons.push('Descriptive title');
    } else if (titleLen < 5) {
      score -= 5;
      reasons.push('Title too short');
    }

    const bodyLen = (issue.body ?? '').trim().length;
    if (bodyLen > 100) {
      score += 10;
      reasons.push('Detailed description');
    } else if (bodyLen < 20) {
      score -= 5;
      reasons.push('Sparse description');
    }

    // Single-file change indicators (body mentions a specific file)
    const fileRefs = (issue.body ?? '').match(/`[^`]+\.\w+`/g);
    if (fileRefs && fileRefs.length > 0 && fileRefs.length <= 3) {
      score += 10;
      reasons.push(`References ${fileRefs.length} specific file(s)`);
    }

    // ── Penalties ──────────────────────────────────────────────────────

    // Complexity keywords
    const lowerBody = (issue.body ?? '').toLowerCase();
    const lowerTitle = issue.title.toLowerCase();
    for (const kw of COMPLEXITY_KEYWORDS) {
      if (lowerBody.includes(kw) || lowerTitle.includes(kw)) {
        score -= 10;
        reasons.push(`Contains "${kw}" — likely complex`);
      }
    }

    // Multi-file change indicator
    if (fileRefs && fileRefs.length > 3) {
      score -= 10;
      reasons.push('References many files — likely multi-file change');
    }

    // Vague patterns
    for (const pat of VAGUE_PATTERNS) {
      if (pat.test(issue.title) || pat.test(issue.body ?? '')) {
        score -= 5;
        reasons.push('Vague wording detected');
        break;
      }
    }

    // Complex labels
    const hasComplexLabel = issue.labels.some((l) => COMPLEX_LABELS.has(l.toLowerCase()));
    if (hasComplexLabel) {
      score -= 10;
      reasons.push('Complex label type');
    }

    // Combo penalty: short title + short body + complex label = very low fixability
    if (titleLen < 10 && bodyLen < 50 && hasComplexLabel) {
      score -= 15;
      reasons.push('Too vague: short title, sparse body, complex scope');
    }

    // ── Clamp ───────────────────────────────────────────────────────────
    score = Math.max(0, Math.min(100, score));

    // ── Confidence & estimated time ─────────────────────────────────────
    let confidence: FixabilityScore['confidence'];
    let estimatedFixTime: string;

    if (score >= 70) {
      confidence = 'high';
      estimatedFixTime = '5–15 min';
    } else if (score >= 40) {
      confidence = 'medium';
      estimatedFixTime = '15–30 min';
    } else {
      confidence = 'low';
      estimatedFixTime = '30–60+ min';
    }

    return {
      issueNumber: issue.issueNumber,
      score,
      confidence,
      reason: reasons.join('; ') || 'Neutral score — no strong signals',
      estimatedFixTime,
    };
  }

  /**
   * Score multiple issues and return them sorted by score descending.
   */
  scoreBatch(issues: IssueData[]): FixabilityScore[] {
    return issues
      .map((issue) => this.score(issue))
      .sort((a, b) => b.score - a.score);
  }
}
