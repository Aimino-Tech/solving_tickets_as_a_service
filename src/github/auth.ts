/**
 * @deprecated Use `@syntaro/github-client` instead.
 * This file re-exports from the standalone package for backward compatibility.
 */
import { readFileSync } from 'node:fs';
import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import {
  createAuth,
  loadPrivateKey,
  createAppOctokit,
  createInstallationOctokit,
  getInstallationToken as getInstallationTokenFromPackage,
  type GitHubAppConfig,
// File outside rootDir, handled at runtime
} from '@syntaro/github-client';

const log = rootLogger.child({ module: 'github-auth' });

let _patOctokit: Octokit | undefined;

function getPatOctokit(): Octokit {
  if (!_patOctokit) {
    _patOctokit = new Octokit({ auth: config.github.token });
  }
  return _patOctokit;
}

function buildConfig(): GitHubAppConfig {
  let privateKey: string;
  if (config.github.privateKeyPath) {
    try {
      privateKey = readFileSync(config.github.privateKeyPath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read private key from ${config.github.privateKeyPath}: ${String(err)}`);
    }
  } else if (config.github.privateKeyEnv) {
    privateKey = config.github.privateKeyEnv;
  } else {
    throw new Error('Either GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY must be set');
  }
  return { appId: config.github.appId, privateKey };
}

let _auth: ReturnType<typeof createAuth> | undefined;

function getAuth() {
  if (!_auth) {
    const cfg = buildConfig();
    _auth = createAuth(cfg, (c) => loadPrivateKey(c));
  }
  return _auth;
}

let _appOctokit: ReturnType<typeof createAppOctokit> | undefined;

function getAppOctokit() {
  if (!_appOctokit) {
    const cfg = buildConfig();
    _appOctokit = createAppOctokit(cfg, (c) => loadPrivateKey(c));
  }
  return _appOctokit;
}

export async function getOctokit(installationId: number): Promise<Octokit> {
  if (!installationId && config.github.token) {
    log.warn('No installation ID — falling back to GITHUB_TOKEN (PAT)');
    return getPatOctokit();
  }
  try {
    return await createInstallationOctokit(getAuth(), installationId);
  } catch (err) {
    throw new Error(`Failed to get Octokit for installation ${installationId}: ${String(err)}`);
  }
}

export async function getInstallationToken(installationId: number): Promise<string> {
  if (!installationId && config.github.token) {
    log.warn('No installation ID — falling back to GITHUB_TOKEN (PAT)');
    return config.github.token;
  }
  try {
    return await getInstallationTokenFromPackage(getAuth(), installationId);
  } catch (err) {
    throw new Error(`Failed to get installation token for installation ${installationId}: ${String(err)}`);
  }
}

export function getAppOctokitInstance(): ReturnType<typeof createAppOctokit> {
  return getAppOctokit();
}

// File outside rootDir, handled at runtime
export { createAuth } from '@syntaro/github-client';
