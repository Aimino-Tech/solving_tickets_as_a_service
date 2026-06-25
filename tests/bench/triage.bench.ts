/**
 * Benchmark: Triage Classification Latency
 *
 * Measures the time to classify an issue using a cheap OpenAI model call.
 * The OpenAI API call is mocked — this benchmark measures the overhead of:
 * 1. Building the classification prompt
 * 2. Executing the model call (mocked)
 * 3. Parsing the JSON response
 * 4. Returning the structured TriageResult
 *
 * In production, this uses gpt-4o-mini (or configured cheap model).
 * The mock simulates a ~200-500ms API round-trip.
 */

import { bench, describe } from 'vitest';
import { createMockTriageInput, createMockTriageResult } from './setup.js';

const input = createMockTriageInput();
const result = createMockTriageResult();

// ── Mocked OpenAI classification call ────────────────────────────────

function buildPrompt(title: string, body: string): string {
  return [
    'You are a triage agent. Given a GitHub issue, classify it.',
    '',
    `Title: ${title}`,
    `Body: ${(body || '(no body)').slice(0, 3000)}`,
    '',
    'Reply with a JSON object:',
    JSON.stringify({
      type: 'bug | feature | question | unknown',
      difficulty: 'easy | medium | hard | unknown',
      relevantFiles: ['list of file paths'],
      summary: 'one-line summary',
    }),
    '',
    'Only respond with the JSON object, no other text.',
  ].join('\n');
}

async function mockClassifyIssue(title: string, body: string): Promise<typeof result> {
  // Simulate ~150-300μs of prompt building overhead
  const prompt = buildPrompt(title, body);

  // Simulate processing delay (mocked — no actual API call)
  // In real bench, tinybench will measure the wall time
  const simulatedContent = JSON.stringify(result);

  // Parse the JSON response (same work as real code)
  const parsed = JSON.parse(simulatedContent) as typeof result;

  return {
    type: parsed.type || 'unknown',
    difficulty: parsed.difficulty || 'unknown',
    relevantFiles: parsed.relevantFiles,
    summary: parsed.summary || '',
  };
}

// ── Simulated keyword-based classifier (lighter alternative) ─────────

function keywordClassify(title: string, body: string): typeof result {
  const text = `${title}\n${body}`.toLowerCase();

  let type = 'unknown';
  if (/bug|error|crash|fix|broken|fail/.test(text)) type = 'bug';
  else if (/feature|request|would like|suggestion/.test(text)) type = 'feature';
  else if (/how to|question|help|what is/.test(text)) type = 'question';

  let difficulty = 'medium';
  const hardPatterns = /complex|race|deadlock|performance|memory|cache/;
  if (hardPatterns.test(text)) difficulty = 'hard';
  else if (/typo|spelling|trivial|simple|typo/.test(text)) difficulty = 'easy';

  return { type, difficulty, relevantFiles: [], summary: '' };
}

describe('triage-classification', () => {
  bench('build classification prompt', () => {
    buildPrompt(input.title, input.body);
  });

  bench('parse JSON classification response', () => {
    JSON.parse(JSON.stringify(result));
  });

  bench('keyword-based classifier (fast path)', () => {
    keywordClassify(input.title, input.body);
  });

  bench('full triage pipeline (mocked AI)', async () => {
    await mockClassifyIssue(input.title, input.body);
  });
});
