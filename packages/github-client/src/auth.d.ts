import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
export interface GitHubAppConfig {
    appId: string | number;
    privateKey: string;
}
export type AppAuth = ReturnType<typeof createAppAuth>;
export declare function loadPrivateKey(config: GitHubAppConfig, options?: {
    readFileSync?: (path: string) => string;
}): string;
export declare function convertPkcs1ToPkcs8(pkcs1Pem: string): string;
export declare function createAuth(config: GitHubAppConfig, loadKey?: (config: GitHubAppConfig) => string): AppAuth;
export declare function createAppOctokit(config: GitHubAppConfig, loadKey?: (config: GitHubAppConfig) => string): Octokit;
export declare function createInstallationOctokit(auth: AppAuth, installationId: number): Promise<Octokit>;
export declare function getInstallationToken(auth: AppAuth, installationId: number): Promise<string>;
