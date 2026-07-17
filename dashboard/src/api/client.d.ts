export declare function setToken(token: string): void;
export declare function clearToken(): void;
export declare const auth: {
    loginUrl: () => string;
    me: () => Promise<{
        user: {
            githubId: string;
            username: string;
            avatarUrl?: string;
        };
    }>;
    logout: () => Promise<{
        success: boolean;
    }>;
};
export declare const runs: {
    list: (params?: {
        page?: number;
        perPage?: number;
        status?: string;
        repo?: string;
        from?: string;
        to?: string;
    }) => Promise<{
        data: import("./types").Run[];
        total: number;
        page: number;
        perPage: number;
        totalPages: number;
    }>;
    get: (id: string) => Promise<any>;
};
export declare const repos: {
    list: () => Promise<any[]>;
    connect: (body: {
        owner: string;
        repo: string;
        installationId?: number;
    }) => Promise<any>;
    disconnect: (id: string) => Promise<{
        success: boolean;
    }>;
};
export declare const stats: {
    get: () => Promise<any>;
};
export declare const audit: {
    list: (params?: {
        page?: number;
        perPage?: number;
    }) => Promise<{
        data: import("./types").AuditEntry[];
        total: number;
        page: number;
        perPage: number;
        totalPages: number;
    }>;
};
export declare const benchmarks: {
    get: () => Promise<{
        generatedAt: string;
        source: string;
        disclaimer: string;
        competitors: import("./types").BenchmarkEntry[];
    }>;
    getPrices: () => Promise<{
        generatedAt: string;
        currency: string;
        prices: import("./types").BenchmarkPrice[];
    }>;
};
export declare const kpi: {
    get: (params?: {
        days?: number;
        from?: string;
        to?: string;
    }) => Promise<any>;
    exportUrl: (days?: number) => string;
};
export declare const pricing: {
    get: () => Promise<any>;
    calculate: (fixes: number, tier?: string) => Promise<any>;
    vs: (competitor: string) => Promise<any>;
};
export declare const settings: {
    get: () => Promise<{
        label: string;
        model: string;
        maxConcurrent: number;
        sandboxPoolSize: number;
        auditLogEnabled: boolean;
    }>;
    update: (body: Record<string, unknown>) => Promise<{
        success: boolean;
    }>;
};
