/**
 * Workspace pricing tiers and calculations — AIM-3321.
 *
 * Defines the pricing model for Slack-first, zero-sales workspace distribution.
 * Four tiers mirror the Viktor distribution strategy: Free (no friction),
 * Solo (individual devs), Team (small teams), Enterprise (orgs).
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * - Free tier: 1 seat, limited features, public repos only
 * - Solo tier: fixed $19/mo, no per-seat cost, private repos
 * - Team tier: base $99 + $10/seat over 3, up to 20 seats
 * - Enterprise: base $499 + $15/seat over 20, unlimited seats
 * ────────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspacePlan {
  id: string;
  name: string;
  description: string;
  price: number; // USD/month base price
  pricePerSeat: number; // USD/month per additional seat beyond minSeats
  minSeats: number;
  maxSeats: number | null; // null = unlimited
  features: string[];
  limits: {
    repos: number | typeof Infinity;
    concurrentJobs: number;
    historyDays: number | typeof Infinity;
    teamMembers: number | typeof Infinity;
  };
}

export interface WorkspaceCostResult {
  plan: WorkspacePlan | undefined;
  total: number;
  perSeat: number;
  breakdown: {
    basePrice: number;
    seatCount: number;
    seatCost: number;
    effectiveSeats: number;
  };
}

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

export const WORKSPACE_PLANS: WorkspacePlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'For open-source and small projects',
    price: 0,
    pricePerSeat: 0,
    minSeats: 1,
    maxSeats: 3,
    features: [
      'GitHub issue → PR automation',
      'Public repositories only',
      'Community support',
      'Basic Slack notifications',
    ],
    limits: {
      repos: 3,
      concurrentJobs: 1,
      historyDays: 30,
      teamMembers: 3,
    },
  },
  {
    id: 'solo',
    name: 'Solo',
    description: 'For individual developers',
    price: 19,
    pricePerSeat: 0,
    minSeats: 1,
    maxSeats: 1,
    features: [
      'Everything in Free +',
      'Private repositories',
      'Priority support',
      'Slack @syntaro mentions',
      'Basic MCP discovery',
    ],
    limits: {
      repos: 10,
      concurrentJobs: 2,
      historyDays: 90,
      teamMembers: 1,
    },
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For small teams',
    price: 99,
    pricePerSeat: 10,
    minSeats: 3,
    maxSeats: 20,
    features: [
      'Everything in Solo +',
      'Jira & Linear integration',
      'Team Slack workspace',
      'Approval workflows',
      'Audit logs',
      'MCP server discovery',
      'Custom labels',
    ],
    limits: {
      repos: 50,
      concurrentJobs: 5,
      historyDays: 365,
      teamMembers: 20,
    },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For organizations',
    price: 499,
    pricePerSeat: 15,
    minSeats: 20,
    maxSeats: null,
    features: [
      'Everything in Team +',
      'Unlimited repositories',
      'On-premise deployment',
      'SSO/SAML',
      'Dedicated support',
      'Custom AI model',
      'SLA guarantees',
      'GDPR compliance docs',
    ],
    limits: {
      repos: Infinity,
      concurrentJobs: 25,
      historyDays: Infinity,
      teamMembers: Infinity,
    },
  },
];

// ---------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------

/**
 * Calculate the total monthly cost for a given plan and seat count.
 *
 * The formula is:
 *   total = basePrice + (pricePerSeat * (effectiveSeats - minSeats))
 *
 * `effectiveSeats` is clamped between `minSeats` and `maxSeats` (if finite).
 *
 * Returns `{ plan: undefined, total: 0, perSeat: 0 }` for unknown plan IDs.
 */
export function calculateWorkspaceCost(
  planId: string,
  seats: number,
): WorkspaceCostResult {
  const plan = WORKSPACE_PLANS.find((p) => p.id === planId);

  if (!plan) {
    return {
      plan: undefined,
      total: 0,
      perSeat: 0,
      breakdown: { basePrice: 0, seatCount: seats, seatCost: 0, effectiveSeats: 0 },
    };
  }

  const effectiveSeats = Math.max(
    plan.minSeats,
    Math.min(seats, plan.maxSeats ?? Infinity),
  );

  const seatCost = plan.pricePerSeat * (effectiveSeats - plan.minSeats);
  const total = plan.price + seatCost;

  return {
    plan,
    total,
    perSeat: plan.pricePerSeat,
    breakdown: {
      basePrice: plan.price,
      seatCount: seats,
      seatCost,
      effectiveSeats,
    },
  };
}

/**
 * List all available workspace plans.
 * Returns a shallow copy to prevent mutation of the canonical list.
 */
export function listWorkspacePlans(): WorkspacePlan[] {
  return [...WORKSPACE_PLANS];
}

/**
 * Find a workspace plan by its ID.
 */
export function findWorkspacePlan(planId: string): WorkspacePlan | undefined {
  return WORKSPACE_PLANS.find((p) => p.id === planId);
}
