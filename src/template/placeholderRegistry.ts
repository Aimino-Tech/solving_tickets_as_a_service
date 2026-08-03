export interface PlaceholderDefinition {
  name: string;
  description: string;
  example: string;
  category: 'issue' | 'repo' | 'template' | 'phase' | 'system';
}

const knownPlaceholders: PlaceholderDefinition[] = [
  { name: 'issue.number', description: 'Issue number', example: '42', category: 'issue' },
  { name: 'issue.title', description: 'Issue title', example: 'Fix broken login', category: 'issue' },
  { name: 'issue.body', description: 'Issue body text', example: 'Users cannot log in', category: 'issue' },
  { name: 'issue.labels', description: 'Comma-separated issue labels', example: 'bug,syntaro:fix', category: 'issue' },
  { name: 'repo.owner', description: 'Repository owner', example: 'owner', category: 'repo' },
  { name: 'repo.name', description: 'Repository name', example: 'my-repo', category: 'repo' },
  { name: 'template.name', description: 'Template name', example: 'fix', category: 'template' },
  { name: 'phase.name', description: 'Current phase name', example: 'pre', category: 'phase' },
];

export function getKnownPlaceholders(): PlaceholderDefinition[] {
  return [...knownPlaceholders];
}

export function findPlaceholder(name: string): PlaceholderDefinition | undefined {
  return knownPlaceholders.find((p) => p.name === name);
}

export function extractPlaceholders(text: string): string[] {
  const regex = /\{([^}]+)\}/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null = regex.exec(text);
  while (match !== null) {
    matches.push(match[1]);
    match = regex.exec(text);
  }
  return [...new Set(matches)];
}

export function suggestPlaceholder(unknown: string): { suggestion: string; distance: number } | null {
  let best: { suggestion: string; distance: number } | null = null;

  for (const known of knownPlaceholders) {
    const dist = levenshteinDistance(unknown.toLowerCase(), known.name.toLowerCase());
    if (dist <= 3 && (!best || dist < best.distance)) {
      best = { suggestion: known.name, distance: dist };
    }
  }

  return best;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[m][n];
}

export function validatePlaceholders(text: string): {
  valid: string[];
  unknown: string[];
  suggestions: Array<{ placeholder: string; suggestion: string }>;
} {
  const found = extractPlaceholders(text);
  const valid: string[] = [];
  const unknown: string[] = [];
  const suggestions: Array<{ placeholder: string; suggestion: string }> = [];

  for (const ph of found) {
    const known = findPlaceholder(ph);
    if (known) {
      valid.push(ph);
    } else {
      unknown.push(ph);
      const suggestion = suggestPlaceholder(ph);
      if (suggestion) {
        suggestions.push({ placeholder: ph, suggestion: suggestion.suggestion });
      }
    }
  }

  return { valid, unknown, suggestions };
}
