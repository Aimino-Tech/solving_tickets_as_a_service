/**
 * Billing types — subscription and usage tracking per account.
 */

export interface Billing {
  id: number;
  accountId: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  usageCount: number;
}

export interface NewBilling {
  id?: number;
  accountId: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  plan?: string;
  status?: string;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  usageCount?: number;
}
