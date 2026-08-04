import { config } from '../../config.js';

export type BitbucketApiVersion = 'cloud' | 'server';

export interface BitbucketPlatformConfig {
  apiVersion: BitbucketApiVersion;
  baseUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  workspace: string;
  tokenUrl: string;
  rateLimitPerHour: number;
}

function detectApiVersion(baseUrl: string): BitbucketApiVersion {
  if (baseUrl.includes('api.bitbucket.org') || baseUrl.includes('bitbucket.org')) {
    return 'cloud';
  }
  return 'server';
}

function buildApiBaseUrl(baseUrl: string, apiVersion: BitbucketApiVersion): string {
  if (apiVersion === 'cloud') {
    return 'https://api.bitbucket.org/2.0';
  }
  return `${baseUrl.replace(/\/+$/, '')}/rest/api/1.0`;
}

export function createBitbucketConfig(): BitbucketPlatformConfig {
  const baseUrl = config.bitbucket.baseUrl || 'https://api.bitbucket.org';
  const apiVersion = detectApiVersion(baseUrl);

  return {
    apiVersion,
    baseUrl,
    apiBaseUrl: buildApiBaseUrl(baseUrl, apiVersion),
    clientId: config.bitbucket.clientId,
    clientSecret: config.bitbucket.clientSecret,
    workspace: config.bitbucket.workspace,
    tokenUrl: config.bitbucket.tokenUrl,
    rateLimitPerHour: apiVersion === 'cloud' ? 1000 : 5000,
  };
}
