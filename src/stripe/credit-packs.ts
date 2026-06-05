/**
 * Credit pack definitions for Stripe Checkout purchases.
 *
 * Each pack maps a Stripe Price ID to a credit amount, bonus credits,
 * a display label, and an amount in cents for the Checkout session.
 */

export const CREDIT_PACKS = {
  small: {
    priceId: 'price_100credits',
    credits: 100,
    bonus: 0,
    label: '100 Credits',
    amount: 1000, // $10.00 in cents
  },
  medium: {
    priceId: 'price_500credits',
    credits: 500,
    bonus: 50,
    label: '500 + 50 Bonus',
    amount: 4500, // $45.00 in cents
  },
  large: {
    priceId: 'price_2000credits',
    credits: 2000,
    bonus: 200,
    label: '2000 + 200 Bonus',
    amount: 15000, // $150.00 in cents
  },
} as const;

export type CreditPackKey = keyof typeof CREDIT_PACKS;

export type CreditPack = (typeof CREDIT_PACKS)[CreditPackKey];

/**
 * Look up a credit pack by its Stripe Price ID.
 * Returns undefined if no pack matches.
 */
export function getCreditPackByPriceId(priceId: string): CreditPack | undefined {
  for (const pack of Object.values(CREDIT_PACKS)) {
    if (pack.priceId === priceId) {
      return pack;
    }
  }
  return undefined;
}

/**
 * Look up a credit pack by its key name.
 */
export function getCreditPack(key: CreditPackKey): CreditPack {
  return CREDIT_PACKS[key];
}
