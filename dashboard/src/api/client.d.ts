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
