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
