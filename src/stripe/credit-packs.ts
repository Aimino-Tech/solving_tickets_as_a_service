/**
 * Credit pack definitions for Stripe Checkout purchases.
 *
 * Each pack maps a Stripe Price ID to a credit amount, bonus credits,
 * a display label, and an amount in cents for the Checkout session.
 * Price IDs are read from config on first access so they can be
 * configured via environment variables (STRIPE_PRICE_100_CREDITS, etc.).
 */

import { config } from '../config.js';

const CREDIT_PACK_DEFS = {
  small: {
    credits: 100,
    bonus: 0,
    label: '100 Credits',
    amount: 1000,
  },
  medium: {
    credits: 500,
    bonus: 50,
    label: '500 + 50 Bonus',
    amount: 4500,
  },
  large: {
    credits: 2000,
    bonus: 200,
    label: '2000 + 200 Bonus',
    amount: 15000,
  },
} as const;

export type CreditPackKey = keyof typeof CREDIT_PACK_DEFS;

export interface CreditPack {
  priceId: string;
  credits: number;
  bonus: number;
  label: string;
  amount: number;
}

/**
 * Look up a credit pack by its Stripe Price ID.
 */
export function getCreditPackByPriceId(priceId: string): CreditPack | undefined {
  return getCreditPacks().find((p) => p.priceId === priceId);
}

/**
 * Look up a credit pack by its key name.
 */
export function getCreditPack(key: CreditPackKey): CreditPack {
  const packs = getCreditPacks();
  const idx = Object.keys(CREDIT_PACK_DEFS).indexOf(key);
  return packs[idx];
}

/**
 * Get all credit packs with config-resolved price IDs.
 * Reads from config on every call so runtime env changes are reflected.
 */
export function getCreditPacks(): CreditPack[] {
  return [
    { ...CREDIT_PACK_DEFS.small, priceId: config.stripe.price100Credits },
    { ...CREDIT_PACK_DEFS.medium, priceId: config.stripe.price500Credits },
    { ...CREDIT_PACK_DEFS.large, priceId: config.stripe.price2000Credits },
  ];
}

/**
 * Legacy static constant for backward compatibility.
 * Prefer getCreditPacks() for config-aware price IDs.
 * @deprecated Use getCreditPacks() which reads price IDs from config
 */
export const CREDIT_PACKS = Object.freeze({
  small: { ...CREDIT_PACK_DEFS.small, priceId: '' },
  medium: { ...CREDIT_PACK_DEFS.medium, priceId: '' },
  large: { ...CREDIT_PACK_DEFS.large, priceId: '' },
} as const);
