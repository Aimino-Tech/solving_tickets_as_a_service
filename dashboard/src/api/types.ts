export interface User {
  githubId: string;
  username: string;
  avatarUrl?: string;
}

export interface Run {
  id: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
  modelUsed?: string;
  costCents?: number;
  durationSeconds?: number;
  prUrl?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Repo {
  id: string;
  owner: string;
  repo: string;
  active: boolean;
  installationId?: number;
  createdAt: string;
}

export interface DashboardStats {
  totalRuns: number;
  passRate: number;
  avgDurationSeconds: number;
  activeRepos: number;
  runsByDay: { date: string; count: number; passed: number }[];
  costByDay: { date: string; costCents: number }[];
  fixRateByWeek: { week: string; rate: number }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface BenchmarkEntry {
  agent: string;
  passRate: number;
  costPerFixCents: number;
  agentNative: boolean;
  oss: boolean;
  selfHostable: boolean;
  note?: string;
}

export interface BenchmarkPrice {
  agent: string;
  model: string;
  costPerFixCents: number;
  monthlyMinCents: number;
  monthlyMaxFixes: number;
}

export interface KpiMetric {
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

export interface KpiResponse {
  metrics: KpiMetric[];
  count: number;
  generatedAt: string;
}
