/**
 * Runs types — individual fix-run attempts with full result metadata.
 */

export interface Run {
  id: number;
  accountId: number;
  repoId: number | null;
  issueNumber: number | null;
  status: string;
  confidence: string | null;
  summary: string | null;
  prUrl: string | null;
  branchName: string | null;
  error: string | null;
  durationMs: number | null;
  modelUsed: string | null;
  creditsUsed: number | null;
  costCents: number | null;
  createdAt: Date;
}

export interface NewRun {
  id?: number;
  accountId: number;
  repoId?: number | null;
  issueNumber?: number | null;
  status?: string;
  confidence?: string | null;
  summary?: string | null;
  prUrl?: string | null;
  branchName?: string | null;
  error?: string | null;
  durationMs?: number | null;
  modelUsed?: string | null;
  creditsUsed?: number | null;
  costCents?: number | null;
  createdAt?: Date;
}
