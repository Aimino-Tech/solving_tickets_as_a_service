import { rootLogger } from '../utils/logger.js';
import type { TriageResult } from './types.js';
import fuzzball from 'fuzzball';

const log = rootLogger.child({ module: 'issue-grounding' });

export interface GroundingCheckResult {
  passed: boolean;
  requirementsChecked: number;
  ungrounded: Array<{
    requirement: string;
    bestMatch: string;
    similarity: number;
  }>;
}

const SIMILARITY_THRESHOLD = 0.7;

function extractRequirements(issueTitle: string, issueBody: string, comments: string[], triage: TriageResult): string[] {
  const requirements: string[] = [];

  const allText = [issueTitle, issueBody, ...comments].filter(Boolean).join('\n');

  const bulletPoints = allText.match(/(?:^|\n)\s*[-*]\s*(.+)/gm);
  if (bulletPoints) {
    for (const bp of bulletPoints) {
      const cleaned = bp.replace(/^[\s\-*]+/, '').trim();
      if (cleaned.length > 10) {
        requirements.push(cleaned);
      }
    }
  }

  const numberedItems = allText.match(/(?:^|\n)\s*\d+[.)]\s*(.+)/gm);
  if (numberedItems) {
    for (const ni of numberedItems) {
      const cleaned = ni.replace(/^[\s\d.)]+/, '').trim();
      if (cleaned.length > 10) {
        requirements.push(cleaned);
      }
    }
  }

  const sentences = allText
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && /(?:should|must|need|require|expect|want|would like|please)/i.test(s));
  for (const s of sentences) {
    requirements.push(s);
  }

  if (triage.summary && triage.summary.length > 10) {
    requirements.push(triage.summary);
  }

  return [...new Set(requirements)];
}

function extractPassages(issueTitle: string, issueBody: string, comments: string[]): string[] {
  const passages: string[] = [];

  const text = [issueTitle, issueBody, ...comments].filter(Boolean).join('\n');

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 15);
  passages.push(...lines);

  if (issueTitle) passages.push(issueTitle);

  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 20);
  passages.push(...paragraphs);

  const sentences = text
    .split(/[.!?]+\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
  passages.push(...sentences);

  return [...new Set(passages)];
}

export async function checkIssueGrounding(
  issueTitle: string,
  issueBody: string | null,
  comments: string[],
  triage: TriageResult,
): Promise<GroundingCheckResult> {
  const effectiveBody = issueBody ?? '';
  const requirements = extractRequirements(issueTitle, effectiveBody, comments, triage);
  const passages = extractPassages(issueTitle, effectiveBody, comments);

  if (requirements.length === 0) {
    return { passed: true, requirementsChecked: 0, ungrounded: [] };
  }

  if (passages.length === 0) {
    return { passed: true, requirementsChecked: 0, ungrounded: [] };
  }

  const ungrounded: Array<{ requirement: string; bestMatch: string; similarity: number }> = [];

  for (const req of requirements) {
    let bestScore = 0;
    let bestPassage = '';

    for (const passage of passages) {
      const score = fuzzball.token_set_ratio(req, passage) / 100;
      if (score > bestScore) {
        bestScore = score;
        bestPassage = passage;
      }
    }

    if (bestScore < SIMILARITY_THRESHOLD) {
      ungrounded.push({
        requirement: req,
        bestMatch: bestPassage.slice(0, 100),
        similarity: bestScore,
      });
      log.warn({ requirement: req, bestScore, bestPassage: bestPassage.slice(0, 100) }, 'Ungrounded requirement detected');
    }
  }

  const passed = ungrounded.length === 0;
  if (!passed) {
    log.warn({ ungroundedCount: ungrounded.length, totalRequirements: requirements.length }, 'Issue grounding check failed');
  }

  return {
    passed,
    requirementsChecked: requirements.length,
    ungrounded,
  };
}
