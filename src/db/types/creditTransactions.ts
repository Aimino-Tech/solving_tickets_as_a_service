/**
 * Credit transactions types — immutable ledger of all credit movements.
 */

export interface CreditTransaction {
  id: number;
  accountId: number;
  amount: number;
  type: string;
  description: string | null;
  stripePaymentIntentId: string | null;
  createdAt: Date;
}

export interface NewCreditTransaction {
  id?: number;
  accountId: number;
  amount: number;
  type: string;
  description?: string | null;
  stripePaymentIntentId?: string | null;
  createdAt?: Date;
}
