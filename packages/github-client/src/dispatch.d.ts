import type { Octokit } from '@octokit/rest';
import type { AgentResult } from './messages.js';
export interface DispatchConfig {
    octokit: Octokit;
    postComment: (issueNumber: number, body: string) => Promise<void>;
    pushBranch: (branchName: string) => Promise<void>;
    getChangedFiles?: (branchName: string, baseBranch: string) => Promise<string[]>;
    addBreadcrumb?: (category: string, message: string, data?: Record<string, string>) => void;
    log?: {
        info: (msg: object, msgText: string) => void;
        warn: (msg: object, msgText: string) => void;
        error: (msg: object, msgText: string) => void;
    };
}
export interface DispatchParams {
    issueNumber: number;
    issueTitle: string;
    agentResult: AgentResult;
    repoOwner: string;
    repoName: string;
    baseBranch?: string;
    botName?: string;
}
export interface DispatchResult {
    action: 'pr_created' | 'draft_pr_created' | 'comment_posted' | 'error';
    prUrl?: string;
    prNumber?: number;
    commentBody?: string;
}
export declare function dispatchAction(config: DispatchConfig, params: DispatchParams): Promise<DispatchResult>;
