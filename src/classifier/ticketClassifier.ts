import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'ticket-classifier' });

export type TicketCategory = 'code' | 'research' | 'design' | 'content' | 'process' | 'other';

export interface ClassificationResult {
  category: TicketCategory;
  isCodeRelated: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

const CODE_INDICATORS = [
  'bug', 'fix', 'error', 'crash', 'refactor', 'implement', 'feat',
  'api', 'endpoint', 'database', 'migration', 'test', 'ci', 'deploy',
  'function', 'method', 'class', 'component', 'hook', 'middleware',
  'type', 'interface', 'schema', 'query', 'mutation', 'route',
  'pr', 'pull request', 'review', 'code', 'compile', 'build',
  'regression', 'performance', 'memory', 'async', 'callback',
  'merge', 'branch', 'commit', 'chore',
];

const NON_CODE_INDICATORS: Record<string, string[]> = {
  research: ['research', 'analysis', 'investigate', 'study', 'report', 'whitepaper', 'findings', 'market', 'competitor', 'landscape'],
  design: ['design', 'ui', 'ux', 'mockup', 'wireframe', 'prototype', 'figma', 'sketch', 'user flow', 'visual', 'layout', 'brand', 'color'],
  content: ['content', 'copy', 'documentation', 'docs', 'wiki', 'blog', 'post', 'article', 'writing', 'readme', 'guide', 'tutorial'],
  process: ['process', 'workflow', 'onboarding', 'planning', 'sprint', 'retro', 'meeting', 'decision', 'strategy', 'roadmap'],
};

export function classifyTicket(title: string, description?: string | null, labels?: string[]): ClassificationResult {
  const text = `${title}\n${description || ''}`.toLowerCase();
  const labelNames = (labels ?? []).map(l => l.toLowerCase());

  const codeScore = CODE_INDICATORS.reduce((sum, kw) => sum + (text.includes(kw) ? 1 : 0), 0);

  const nonCodeScores: Record<string, number> = {};
  for (const [category, keywords] of Object.entries(NON_CODE_INDICATORS)) {
    nonCodeScores[category] = keywords.reduce((sum, kw) => sum + (text.includes(kw) ? 1 : 0), 0);
  }

  const maxNonCodeScore = Math.max(...Object.values(nonCodeScores), 0);
  const topNonCodeCategory = (Object.entries(nonCodeScores).find(([, s]) => s === maxNonCodeScore)?.[0] || 'other') as TicketCategory;

  const isLabelCodeRelated = labelNames.some(l =>
    ['bug', 'enhancement', 'feature', 'code', 'pipeline'].includes(l)
  );
  const isLabelNonCode = labelNames.some(l =>
    ['research', 'design', 'content', 'documentation', 'process'].includes(l)
  );

  log.info({ codeScore, maxNonCodeScore, topNonCodeCategory, labels }, 'Ticket classification scores');

  if (isLabelCodeRelated || (codeScore > maxNonCodeScore && codeScore >= 2)) {
    return {
      category: 'code',
      isCodeRelated: true,
      confidence: codeScore >= 3 ? 'high' : 'medium',
      reasoning: `Code indicators: ${codeScore}, non-code: ${maxNonCodeScore}`,
    };
  }

  if (maxNonCodeScore > 0 || isLabelNonCode) {
    return {
      category: topNonCodeCategory,
      isCodeRelated: false,
      confidence: maxNonCodeScore >= 2 ? 'high' : 'medium',
      reasoning: `Non-code category: ${topNonCodeCategory}, score: ${maxNonCodeScore}`,
    };
  }

  return {
    category: 'other',
    isCodeRelated: false,
    confidence: 'low',
    reasoning: 'No clear indicators found — classified as other',
  };
}
