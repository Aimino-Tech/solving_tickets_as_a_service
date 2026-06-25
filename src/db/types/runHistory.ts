/**
 * Run history types — records every fix run from start to completion.
 */

export interface RunHistory {
  id: number;
  accountId: number;
  issueId: number | null;
  repo: string | null;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  result: string | null;
}

export interface NewRunHistory {
  id?: number;
  accountId: number;
  issueId?: number | null;
  repo?: string | null;
  status?: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  result?: string | null;
}
