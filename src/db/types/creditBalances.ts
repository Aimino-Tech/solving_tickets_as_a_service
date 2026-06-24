/**
 * Credit balances types — tracks current balance and lifetime credits per account.
 */

export interface CreditBalance {
  id: number;
  accountId: number;
  balance: number;
  lifetimeCredits: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCreditBalance {
  id?: number;
  accountId: number;
  balance?: number;
  lifetimeCredits?: number;
  createdAt?: Date;
  updatedAt?: Date;
}
