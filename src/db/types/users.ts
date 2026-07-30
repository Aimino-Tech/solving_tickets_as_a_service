export type UserPlan = 'selfHosted' | 'free' | 'solo' | 'team' | 'enterprise';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'inactive';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  plan: UserPlan;
  trialStart: Date | null;
  trialEnd: Date | null;
  stripeCustomerId: string | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewUser {
  id?: string;
  email: string;
  passwordHash?: string;
  name?: string | null;
  plan?: UserPlan;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  stripeCustomerId?: string | null;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionId?: string | null;
}
