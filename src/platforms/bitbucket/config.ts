import { config } from '../../config.js';

export type BitbucketApiVersion = 'cloud' | 'server';

export interface BitbucketPlatformConfig {
  apiVersion: BitbucketApiVersion;
  baseUrl: string;
  apiBaseUrl: string;
  username: string;
  appPassword: string;
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
    username: config.bitbucket.username,
    appPassword: config.bitbucket.appPassword,
    rateLimitPerHour: apiVersion === 'cloud' ? 1000 : 5000,
  };
}
