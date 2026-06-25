/**
 * @deprecated Use `@stas/github-client` instead.
 * This file re-exports from the standalone package for backward compatibility.
 */
import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import {
  loadPrivateKey as loadKey,
  createAuth,
  createAppOctokit,
  createInstallationOctokit,
  getInstallationToken as getInstallationTokenFromPackage,
  type GitHubAppConfig,
} from '../../packages/github-client/src/index.js';

const log = rootLogger.child({ module: 'github-auth' });

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
    const loadOpts = config.github.privateKeyPath
      ? { readFileSync: readFileSync as (path: string) => string }
      : undefined;
    _auth = createAuth(cfg, loadOpts ? (c) => loadKey(c, loadOpts) : undefined);
  }
  return _auth;
}

let _appOctokit: ReturnType<typeof createAppOctokit> | undefined;

function getAppOctokit() {
  if (!_appOctokit) {
    const cfg = buildConfig();
    const loadOpts = config.github.privateKeyPath
      ? { readFileSync: readFileSync as (path: string) => string }
      : undefined;
    _appOctokit = createAppOctokit(cfg, loadOpts ? (c) => loadKey(c, loadOpts) : undefined);
  }
  return _appOctokit;
}

export async function getOctokit(installationId: number): Promise<ReturnType<typeof createInstallationOctokit>> {
  try {
    return await createInstallationOctokit(getAuth(), installationId);
  } catch (err) {
    throw new Error(`Failed to get Octokit for installation ${installationId}: ${String(err)}`);
  }
}

export async function getInstallationToken(installationId: number): Promise<string> {
  try {
    return await getInstallationTokenFromPackage(getAuth(), installationId);
  } catch (err) {
    throw new Error(`Failed to get installation token for installation ${installationId}: ${String(err)}`);
  }
}

export function getAppOctokitInstance(): ReturnType<typeof createAppOctokit> {
  return getAppOctokit();
}
