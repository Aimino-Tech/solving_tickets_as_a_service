import { createPrivateKey } from 'node:crypto';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

export interface GitHubAppConfig {
  appId: string | number;
  privateKey: string;
}

export type AppAuth = ReturnType<typeof createAppAuth>;

export function loadPrivateKey(config: GitHubAppConfig, options?: { readFileSync?: (path: string) => string }): string {
  let pem: string;
  if (options?.readFileSync) {
    pem = options.readFileSync(config.privateKey);
  } else {
    pem = config.privateKey.replace(/\\n/g, '\n');
  }
  pem = pem.replace(/\r\n/g, '\n').trim();
  if (pem.includes('-----BEGIN PRIVATE KEY-----')) return pem;
  if (pem.includes('-----BEGIN RSA PRIVATE KEY-----')) return convertPkcs1ToPkcs8(pem);
  return pem;
}

export function convertPkcs1ToPkcs8(pkcs1Pem: string): string {
  try {
    const keyObject = createPrivateKey(pkcs1Pem);
    return keyObject.export({ type: 'pkcs8', format: 'pem' }).toString('utf-8').trim();
  } catch (err) {
    throw new Error(`Failed to convert PKCS#1 private key to PKCS#8: ${String(err)}`);
  }
}

export function createAuth(config: GitHubAppConfig, loadKey?: (config: GitHubAppConfig) => string): AppAuth {
  const privateKey = (loadKey ?? loadPrivateKey)(config);
  return createAppAuth({ appId: config.appId, privateKey });
}

export function createAppOctokit(config: GitHubAppConfig, loadKey?: (config: GitHubAppConfig) => string): Octokit {
  const privateKey = (loadKey ?? loadPrivateKey)(config);
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: config.appId, privateKey },
  });
}

export async function createInstallationOctokit(auth: AppAuth, installationId: number): Promise<Octokit> {
  try {
    const { token } = await auth({ type: 'installation', installationId });
    return new Octokit({ auth: token });
  } catch (err) {
    throw new Error(`Failed to get Octokit for installation ${installationId}: ${String(err)}`);
  }
}

export async function getInstallationToken(auth: AppAuth, installationId: number): Promise<string> {
  try {
    const { token } = await auth({ type: 'installation', installationId });
    return token;
  } catch (err) {
    throw new Error(`Failed to get installation token for installation ${installationId}: ${String(err)}`);
  }
}
