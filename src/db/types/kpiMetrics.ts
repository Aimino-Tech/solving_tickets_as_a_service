export interface KpiMetrics {
  id: number;
  snapshotDate: string;
  activeReposMa: number;
  fixCompletionRate: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  freeAccounts: number;
  paidAccounts: number;
  freeToPaidConversion: number;
  netRevenueCents: number;
  churnRate: number;
  churnedAccounts: number;
  viralCoefficient: number;
  referredAccounts: number;
  totalNewAccounts: number;
  createdAt: string;
}

export interface NewKpiMetrics {
  snapshotDate: string;
  activeReposMa: number;
  fixCompletionRate: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  freeAccounts: number;
  paidAccounts: number;
  freeToPaidConversion: number;
  netRevenueCents: number;
  churnRate: number;
  churnedAccounts: number;
  viralCoefficient: number;
  referredAccounts: number;
  totalNewAccounts: number;
}
