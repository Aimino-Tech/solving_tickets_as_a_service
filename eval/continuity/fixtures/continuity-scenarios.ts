/**
 * Continuity eval scenario fixtures (AIM-4445).
 *
 * Each scenario is a 10-turn conversation:
 *   - turns 1..seedTurns  seed facts the agent must remember,
 *   - turns (seedTurns+1)..10 reference those facts implicitly.
 *
 * `scriptedReply` is the reply a well-behaved (memory-ful) agent gives.
 * It is used by ScriptedMemorySUT to simulate a perfect agent so the
 * harness + goldfish detector can be proven correct in CI without a live
 * model. The GoldfishSUT ignores these replies and always asks for
 * re-explanation, proving the harness FAILS a memory-less baseline.
 */
export interface ContinuityTurn {
  /** 1-based turn number (index + 1). */
  turn: number;
  /** The user message sent to the SUT. */
  user: string;
  /** Expected reply from a memory-ful agent (must be goldfish-free). */
  scriptedReply: string;
}

export interface ContinuityScenario {
  id: string;
  description: string;
  /** Number of leading turns that seed facts (not goldfish-checked). */
  seedTurns: number;
  /** Total turns in the conversation (must be > seedTurns). */
  totalTurns: number;
  turns: ContinuityTurn[];
}

export const PROJECT_ONBOARDING: ContinuityScenario = {
  id: 'project-onboarding',
  description: 'User introduces a project (name, stack, deadline, compliance) and later references those facts.',
  seedTurns: 3,
  totalTurns: 10,
  turns: [
    {
      turn: 1,
      user: "Hey, I'm starting a new project called 'Aurora'. It's a Python microservice for invoice processing.",
      scriptedReply:
        'Got it - Aurora, a Python microservice for invoice processing. What stack details matter for you?',
    },
    {
      turn: 2,
      user: 'We use FastAPI with PostgreSQL and deploy on Kubernetes.',
      scriptedReply: 'Aurora runs FastAPI with PostgreSQL on Kubernetes. Anything else I should remember?',
    },
    {
      turn: 3,
      user: 'Launch deadline is end of October, and the only critical constraint is PCI compliance for the billing part.',
      scriptedReply: 'Recorded: Aurora launches end of October, PCI compliance required for the billing part.',
    },
    { turn: 4, user: "What's the deadline again?", scriptedReply: "Aurora's launch deadline is end of October." },
    { turn: 5, user: 'Remind me what framework we chose.', scriptedReply: 'Aurora uses FastAPI.' },
    {
      turn: 6,
      user: 'Any compliance requirements I mentioned?',
      scriptedReply: 'Yes - PCI compliance for the billing part.',
    },
    { turn: 7, user: 'Where are we deploying?', scriptedReply: 'Kubernetes, with PostgreSQL as the database.' },
    { turn: 8, user: 'What language is Aurora written in?', scriptedReply: 'Python.' },
    {
      turn: 9,
      user: 'Does the compliance requirement cover the whole app or just billing?',
      scriptedReply: 'Just the billing part - that is the PCI-scoped piece.',
    },
    {
      turn: 10,
      user: "Can you summarize what we've decided so far?",
      scriptedReply:
        'Aurora: Python (FastAPI) microservice, PostgreSQL on Kubernetes, PCI compliance on billing, launch end of October.',
    },
  ],
};

export const ISSUE_TRIAGE: ContinuityScenario = {
  id: 'issue-triage',
  description: 'User reports a production bug with symptoms, frequency, and a suspected integration, then follows up.',
  seedTurns: 3,
  totalTurns: 10,
  turns: [
    {
      turn: 1,
      user: "I'm seeing a bug where the checkout page times out when the cart has more than 5 items.",
      scriptedReply:
        'A checkout timeout bug with carts over 5 items - I am tracking that. What severity would you assign?',
    },
    {
      turn: 2,
      user: "It happens on production about 30% of the time, and it's blocking payments.",
      scriptedReply: 'Production, roughly 30% of the time, blocking payments. That is high severity. Any error logs?',
    },
    {
      turn: 3,
      user: "The logs show a gateway timeout on the payment provider call - it's the Stripe integration.",
      scriptedReply: 'Root cause area: gateway timeout on the Stripe payment provider call.',
    },
    {
      turn: 4,
      user: 'Which integration is involved?',
      scriptedReply: 'The Stripe integration - the payment provider call.',
    },
    { turn: 5, user: 'How often did you say it fails?', scriptedReply: 'About 30% of the time, on production.' },
    {
      turn: 6,
      user: 'Is it tied to a specific cart size?',
      scriptedReply: 'Yes - it starts when the cart has more than 5 items.',
    },
    { turn: 7, user: "What's the impact?", scriptedReply: "It's blocking payments, so it is high severity." },
    {
      turn: 8,
      user: 'Where in the codebase should I look first?',
      scriptedReply: 'The payment provider call path in checkout, where the Stripe integration is invoked.',
    },
    {
      turn: 9,
      user: 'Do we have logs confirming the timeout?',
      scriptedReply: 'Yes - the logs show a gateway timeout on the payment provider call.',
    },
    {
      turn: 10,
      user: 'Summarize the bug ticket for me.',
      scriptedReply:
        'Checkout times out with carts over 5 items, ~30% of the time in production, blocking payments. Logs show a gateway timeout on the Stripe payment provider call.',
    },
  ],
};

export const PLAN_SESSION: ContinuityScenario = {
  id: 'plan-session',
  description: 'User plans an auth migration and iterates on constraints the agent must carry across turns.',
  seedTurns: 3,
  totalTurns: 10,
  turns: [
    {
      turn: 1,
      user: "Let's plan the migration of our auth system from sessions to JWT.",
      scriptedReply: 'Migration to JWT for auth - what are the constraints?',
    },
    {
      turn: 2,
      user: 'We must keep single sign-on for existing users, and the new tokens expire every 15 minutes.',
      scriptedReply: 'Recorded: SSO must keep working for existing users; JWT expiry is 15 minutes.',
    },
    {
      turn: 3,
      user: "Also, we can't have any downtime during the cutover, and the team has two weeks.",
      scriptedReply: 'Noted: zero-downtime cutover, two-week timeline.',
    },
    { turn: 4, user: "What's the token lifetime?", scriptedReply: 'JWTs expire every 15 minutes.' },
    {
      turn: 5,
      user: 'What are the hard constraints for the cutover?',
      scriptedReply: 'Zero downtime and SSO for existing users must keep working.',
    },
    { turn: 6, user: 'How much time does the team have?', scriptedReply: 'Two weeks.' },
    {
      turn: 7,
      user: 'Is there a constraint I set about existing users?',
      scriptedReply: 'Yes - single sign-on for existing users must be preserved.',
    },
    { turn: 8, user: 'What auth mechanism are we migrating away from?', scriptedReply: 'From session-based auth.' },
    {
      turn: 9,
      user: "What should the plan's first milestone cover?",
      scriptedReply: 'The JWT token flow - issuance with the 15-minute expiry - while preserving SSO.',
    },
    {
      turn: 10,
      user: 'Give me the full plan summary.',
      scriptedReply:
        'Migrate auth from sessions to JWT: 15-minute expiry, SSO preserved for existing users, zero-downtime cutover, delivered within two weeks.',
    },
  ],
};

export const ALL_SCENARIOS: ContinuityScenario[] = [PROJECT_ONBOARDING, ISSUE_TRIAGE, PLAN_SESSION];

export function getScenario(id: string): ContinuityScenario {
  const scenario = ALL_SCENARIOS.find((s) => s.id === id);
  if (!scenario) {
    throw new Error(`Unknown continuity scenario: ${id}`);
  }
  return scenario;
}
