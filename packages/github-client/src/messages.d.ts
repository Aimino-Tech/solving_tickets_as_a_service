export declare const DEFAULT_BOT_NAME = "STAS";
export interface VerificationResult {
    preExistingTestsRegressed?: boolean;
    regressionTestCreated?: boolean;
    regressionTestPassedOnOriginal?: boolean;
    regressionTestPassedOnFix?: boolean;
    unverified?: boolean;
    details: string[];
}
export interface AgentResult {
    summary: string;
    fixReady?: boolean;
    alreadyFixed?: boolean;
    investigationOnly?: boolean;
    noFixReason?: string;
    confidence?: 'high' | 'medium' | 'low';
    branchName?: string;
    diff?: string;
    errors?: string[];
    testOutput?: string;
    verification?: VerificationResult;
}
export declare function highConfidenceIssueComment(prNumber: number, result: AgentResult, botName?: string): string;
export declare function draftIssueComment(prNumber: number, result: AgentResult, botName?: string): string;
export declare function lowConfidenceComment(result: AgentResult, testOutput: string, botName?: string): string;
export declare function noFixComment(result: AgentResult, relevantPRs?: Array<{
    url: string;
    title: string;
    state: string;
}>, botName?: string): string;
export declare function noResultComment(botName?: string): string;
export declare function investigationComment(summary: string, botName?: string): string;
export declare function alreadyFixedComment(result: AgentResult, botName?: string): string;
export declare function errorComment(message: string, botName?: string): string;
export declare function featureSkipComment(botName?: string): string;
export declare function questionSkipComment(botName?: string): string;
export declare function timeoutComment(phase: string, timeoutMs: number, botName?: string): string;
export declare function retryComment(attempt: number, model: string, error: string, botName?: string): string;
export declare function modelFallbackComment(model: string, previousError: string, botName?: string): string;
export declare function queueRetryComment(attempt: number, maxRetries: number, error: string, botName?: string): string;
export declare function deadLetterComment(error: string, botName?: string): string;
export declare function phantomIssueComment(missingFiles: string[], skipReason: string, botName?: string): string;
export declare function ciFailureComment(prNumber: number, failedChecks: string[], botName?: string): string;
export declare function regressionBlockComment(result: AgentResult, botName?: string): string;
export declare function verificationWarningComment(result: AgentResult, botName?: string): string;
export declare function buildPRBody(params: {
    issueNumber: number;
    result: AgentResult;
    fileLinks: string[];
    isDraft: boolean;
    branchName: string;
    botName?: string;
}): string;
