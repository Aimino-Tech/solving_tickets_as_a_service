/**
 * Stub declarations for @stas/github-client package.
 * Re-exports from the actual package at runtime.
 */

import { Octokit } from '@octokit/rest';

// Types
export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
}

export interface AgentResult {
  [key: string]: unknown;
  summary?: string;
  reasoning?: string;
  confidence?: number;
  files?: string[];
}

export interface VerificationResult {
  passed: boolean;
  details: string;
  severity?: string;
}

// Message generators - variadic to match actual implementation
export function noResultComment(...args: any[]): string { return ''; }
export function investigationComment(...args: any[]): string { return ''; }
export function alreadyFixedComment(...args: any[]): string { return ''; }
export function errorComment(...args: any[]): string { return ''; }
export function featureSkipComment(...args: any[]): string { return ''; }
export function questionSkipComment(...args: any[]): string { return ''; }
export function timeoutComment(...args: any[]): string { return ''; }
export function retryComment(...args: any[]): string { return ''; }
export function modelFallbackComment(...args: any[]): string { return ''; }
export function queueRetryComment(...args: any[]): string { return ''; }
export function deadLetterComment(...args: any[]): string { return ''; }
export function phantomIssueComment(...args: any[]): string { return ''; }
export function ciFailureComment(...args: any[]): string { return ''; }
export function regressionBlockComment(...args: any[]): string { return ''; }
export function verificationWarningComment(...args: any[]): string { return ''; }
export function buildPRBody(...args: any[]): string { return ''; }
export function highConfidenceIssueComment(...args: any[]): string { return ''; }
export function draftIssueComment(...args: any[]): string { return ''; }
export function lowConfidenceComment(...args: any[]): string { return ''; }
export function noFixComment(...args: any[]): string { return ''; }


// Auth functions
export function loadPrivateKey(config: GitHubAppConfig, options?: { readFileSync?: (path: string) => string }): string {
  return config.privateKey;
}

export function createAuth(config: GitHubAppConfig, loadKeyFn?: (c: GitHubAppConfig) => string): any {
  return {};
}

export function createAppOctokit(config: GitHubAppConfig, loadKeyFn?: (c: GitHubAppConfig) => string): any {
  return {};
}

export async function createInstallationOctokit(auth: any, installationId: number): Promise<Octokit> {
  return new Octokit();
}

export async function getInstallationToken(auth: any, installationId: number): Promise<string> {
  return '';
}

// Verification
export async function verifyPR(context: any, result: VerificationResult): Promise<boolean> {
  return true;
}
