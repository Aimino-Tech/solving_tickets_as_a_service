export interface User {
  id: string;
  email: string;
  name: string | null;
  username?: string;
  avatarUrl?: string;
  plan?: string;
  createdAt?: string;
  isAdmin?: boolean;
  role?: string;
  impersonating?: boolean;
  impersonator?: { id: string; email: string };
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
  durationMs?: number;
  prUrl?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  confidence?: 'high' | 'medium' | 'low';
  diff?: string;
  testOutput?: string;
  creditsUsed?: number;
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

export interface IncidentCatalogInfo {
  repos: string[];
  purpose: string | null;
  runbook: string | null;
}

export interface IncidentPr {
  repo: string;
  prUrl: string;
  status?: string;
}

export interface Incident {
  fingerprint: string;
  service: string;
  title: string;
  severity: number;
  severityLabel: string;
  environment?: string;
  labels: string[];
  traceId?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  dispatchedAt?: string;
  resolvedAt?: string;
  status: 'active' | 'resolved';
  difficulty: number;
  variant?: string;
  repos: string[];
  prs: IncidentPr[];
  catalog?: IncidentCatalogInfo;
}

export interface IncidentStats {
  active: number;
  resolved: number;
  total: number;
  mttrSeconds: number | null;
  bySeverity: Record<string, number>;
}

export interface IncidentListResponse extends PaginatedResponse<Incident> {
  stats: IncidentStats;
  source: string;
}

export interface ServiceCatalogEntry {
  id: number;
  name: string;
  repos: string[];
  purpose: string | null;
  runbook: string | null;
  providers: string[];
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

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  price: string;
  period: string;
  fixes: string;
  monthlyFixLimit: number;
  concurrentFixes: number;
  premiumModels: boolean;
  prioritySupport: boolean;
  customWebhooks: boolean;
  sla: boolean;
  features: string[];
  cta: string;
  highlighted: boolean;
}

export interface CompetitorPrice {
  competitor: string;
  monthlyCostCents: number;
  costPerFixCents: number;
  fixesPerMonth: number;
  passRate: number;
  selfHosted: boolean;
  openSource: boolean;
  ourAgi: boolean;
}

export interface CostCalculation {
  fixesPerMonth: number;
  monthlyCostCents: number;
  costPerFixCents: number;
  annualSavingsCents: number;
  vsCompetitors: Array<{
    name: string;
    monthlyCostCents: number;
    savingsCents: number;
    savingsPercent: number;
  }>;
}

export interface LitellmUsage {
  remainingBudget: number;
  maxBudget: number;
  budgetResetAt: string | null;
  tokensToday: { input: number; output: number; total: number };
  requestsToday: number;
  costToday: number;
  tokensMonth: { input: number; output: number; total: number };
  requestsMonth: number;
  costMonth: number;
  rateLimit: {
    rpmRemaining: number;
    tpmRemaining: number;
    rpmLimit: number;
    tpmLimit: number;
    resetAt: string | null;
  };
}

export interface PricingData {
  generatedAt: string;
  plans: PricingPlan[];
  competitors: CompetitorPrice[];
}

export interface McpApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revealable?: boolean;
}

export interface VsComparisonData {
  competitor: string;
  competitorName: string;
  tagline: string;
  ourAdvantage: string;
  categories: Array<{
    name: string;
    items: Array<{
      feature: string;
      us: string;
      them: string;
      advantage: 'us' | 'them' | 'tie';
    }>;
  }>;
  priceComparison: {
    ourMonthlyCents: number;
    theirMonthlyCents: number;
    ourPerFixCents: number;
    theirPerFixCents: number;
    annualSavingsCents: number;
  };
  benchmarkComparison: {
    ourPassRate: number;
    theirPassRate: number;
    ourCostPerFixCents: number;
    theirCostPerFixCents: number;
  };
}
