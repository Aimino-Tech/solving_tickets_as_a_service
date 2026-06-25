/**
 * Usage records types — tracks credits consumed per fix run.
 */

export interface UsageRecord {
  id: number;
  accountId: number;
  issueId: number | null;
  repo: string | null;
  action: string;
  creditsUsed: number;
  timestamp: Date;
}

export interface NewUsageRecord {
  id?: number;
  accountId: number;
  issueId?: number | null;
  repo?: string | null;
  action: string;
  creditsUsed?: number;
  timestamp?: Date;
}
