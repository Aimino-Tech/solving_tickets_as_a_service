/**
 * AIM-4445 — Continuity eval scenario fixtures.
 *
 * Each scenario is a scripted 10-turn conversation. Turns 1-3 seed facts,
 * decisions, plan and preferences (messages the ruleBasedExtractor recognises).
 * Turns 4-10 reference those seeds implicitly so the harness can assert the
 * agent answers from context — never asking the user to repeat, remind, or
 * re-explain anything already established.
 *
 * The fixture lint test (continuity-scenarios.test.ts) verifies:
 *  - exactly 10 turns per scenario
 *  - turns 4-10 each reference at least one seeded value (no dangling turns)
 *  - turns 1-3 actually seed memory via ruleBasedExtractor
 */

export interface ContinuityScenario {
  id: string;
  name: string;
  description: string;
  /** Distinctive substrings established in turns 1-3 that turns 4-10 must reference. */
  seedValues: string[];
  /** Exactly 10 user messages. */
  turns: string[];
}

export const SCENARIOS: ContinuityScenario[] = [
  {
    id: 'dev-task',
    name: 'Dev-task conversation',
    description:
      'User describes a billing API project, storage decision and delivery plan; follow-ups reference them without re-explaining.',
    seedValues: ['invoice-service', 'postgresql', 'typescript', 'friday', 'concise', 'storage'],
    turns: [
      'My name is Alice. The project is invoice-service, a billing API.',
      'We decided to use PostgreSQL for storage. The language is TypeScript.',
      'The plan is to ship the API by Friday. I prefer concise responses.',
      'How does PostgreSQL work with the invoice-service?',
      'What language is the API written in — TypeScript?',
      'Is the Friday delivery still on track?',
      'Please keep the summary concise, as we discussed.',
      'What is the invoice-service project about?',
      'Remind me what we picked for storage.',
      "What's the plan — are we still shipping the API by Friday?",
    ],
  },
  {
    id: 'bug-fix',
    name: 'Bug-fix conversation',
    description:
      'User describes a pagination bug fix with a backwards-compatibility constraint and a chosen approach.',
    seedValues: ['customer-service', 'compatible', 'pagination', 'express'],
    turns: [
      'We are building customer-service. The framework is Express.',
      'We must keep changes backwards compatible. The plan is to add pagination.',
      "Let's use cursor-based pagination for the list endpoint.",
      'How does the pagination decision affect customer-service?',
      'We said we must keep changes backwards compatible — does that still hold?',
      'Which framework did we pick for customer-service?',
      "What's the plan for the pagination endpoint?",
      'Is Express still the framework we are using?',
      'The plan mentioned pagination — what approach did we settle on?',
      'Summarize the pagination plan and the compatibility constraint.',
    ],
  },
  {
    id: 'research',
    name: 'Research conversation',
    description:
      'User evaluates a vector database for an embeddings service with a cost cap and benchmark deadline.',
    seedValues: ['ai-search', 'pgvector', 'cost', 'benchmark', 'concise'],
    turns: [
      'My name is Bob. The project is ai-search, an embeddings service.',
      'We decided to use pgvector for storage. The plan is to benchmark by the end of month.',
      'We must keep costs below fifty dollars a month. I prefer concise answers.',
      'How does pgvector handle the ai-search embeddings?',
      "What's the constraint on monthly cost?",
      'Is the end of month benchmark still the plan?',
      'Did we settle on pgvector for storage?',
      'What project — ai-search?',
      'What did we decide about pgvector, Bob?',
      'Keep it concise for the final report, as I prefer.',
    ],
  },
];

export function seedValuesFor(scenarioId: string): string[] {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  return scenario ? scenario.seedValues : [];
}

/** Case-insensitive check that a follow-up turn references at least one seeded value. */
export function referencesSeed(turn: string, seedValues: string[]): boolean {
  const lower = turn.toLowerCase();
  return seedValues.some((v) => lower.includes(v.toLowerCase()));
}
