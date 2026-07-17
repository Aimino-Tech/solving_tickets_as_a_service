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
    confidence?: 'high' | 'medium' | 'low';
    diff?: string;
    testOutput?: string;
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
    runsByDay: {
        date: string;
        count: number;
        passed: number;
    }[];
    costByDay: {
        date: string;
        costCents: number;
    }[];
    fixRateByWeek: {
        week: string;
        rate: number;
    }[];
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
export interface PricingData {
    generatedAt: string;
    plans: PricingPlan[];
    competitors: CompetitorPrice[];
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
