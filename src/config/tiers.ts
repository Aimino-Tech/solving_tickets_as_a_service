/**
 * Tier limit configuration for SYNTARO usage-based pricing.
 *
 * Each tier defines:
 *   - monthlyFixLimit: Max fixes per month (Infinity for self-hosted)
 *   - features: Feature flags enabled for this tier
 *   - metadata: Human-readable labels
 */

export type TierName = 'self-hosted' | 'cloud-free' | 'cloud-pro' | 'cloud-business';

export interface TierConfig {
  /** Human-readable display name. */
  displayName: string;
  /** Max fixes allowed per month. */
  monthlyFixLimit: number;
  /** Feature flags enabled for this tier. */
  features: string[];
  /** SLA target (e.g. "99.9% uptime") or null. */
  sla: string | null;
  /** SSO support. */
  sso: boolean;
  /** Monthly price in USD (0 for free/self-hosted). */
  priceUsd: number;
}

/** Sentinel value representing unlimited usage. */
export const UNLIMITED = Infinity;

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

const tiers: Record<TierName, TierConfig> = {
  'self-hosted': {
    displayName: 'Self-Hosted',
    monthlyFixLimit: UNLIMITED,
    features: ['unlimited-fixes', 'custom-model', 'byo-infrastructure'],
    sla: null,
    sso: false,
    priceUsd: 0,
  },
  'cloud-free': {
    displayName: 'Cloud Free',
    monthlyFixLimit: 10,
    features: ['basic-analytics'],
    sla: null,
    sso: false,
    priceUsd: 0,
  },
  'cloud-pro': {
    displayName: 'Cloud Pro',
    monthlyFixLimit: 100,
    features: ['basic-analytics', 'full-analytics', 'audit-log', 'priority-support'],
    sla: '99.9% uptime',
    sso: false,
    priceUsd: 49,
  },
  'cloud-business': {
    displayName: 'Cloud Business',
    monthlyFixLimit: 500,
    features: [
      'basic-analytics',
      'full-analytics',
      'audit-log',
      'priority-support',
      'sso',
      'vpc',
      'custom-sla',
    ],
    sla: '99.95% uptime',
    sso: true,
    priceUsd: 199,
  },
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a tier name (case-insensitive) to its configuration.
 * Falls back to 'cloud-free' for unknown values.
 */
export function getTierConfig(tierName: string): TierConfig {
  const normalized = tierName.toLowerCase().replace(/_/g, '-');
  const known = tiers[normalized as TierName];
  if (known) return known;

  // Fallback to cloud-free
  return tiers['cloud-free'];
}

/**
 * Return all known tier names.
 */
export function listTierNames(): TierName[] {
  return Object.keys(tiers) as TierName[];
}

/**
 * Return all tier configs.
 */
export function listTierConfigs(): Record<TierName, TierConfig> {
  return { ...tiers };
}

export { tiers };
