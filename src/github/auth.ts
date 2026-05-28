/**
 * GitHub App authentication — installation tokens with Octokit.
 *
 * Handles PKCS#1 → PKCS#8 conversion for Node 20 / OpenSSL 3 compatibility.
 * Supports reading the private key from a file path (GITHUB_APP_PRIVATE_KEY_PATH)
 * or directly from an env var (GITHUB_APP_PRIVATE_KEY).
 */

import { readFileSync } from "node:fs";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config } from "../config.js";
import { rootLogger } from "../utils/logger.js";

const log = rootLogger.child({ module: "github-auth" });

/**
 * Read and normalise the GitHub App PEM private key.
 * Handles PKCS#1 → PKCS#8 conversion required by Node 20+ / OpenSSL 3.
 */
function loadPrivateKey(): string {
  let pem: string;

  if (config.github.privateKeyPath) {
    pem = readFileSync(config.github.privateKeyPath, "utf-8");
  } else if (config.github.privateKeyEnv) {
    pem = config.github.privateKeyEnv.replace(/\\n/g, "\n");
  } else {
    throw new Error(
      "Either GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY must be set",
    );
  }

  // Normalise line endings
  pem = pem.replace(/\r\n/g, "\n").trim();

  // Check if already PKCS#8
  if (pem.includes("-----BEGIN PRIVATE KEY-----")) {
    return pem;
  }

  // PKCS#1 → PKCS#8 conversion for OpenSSL 3 compatibility
  if (pem.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    log.info("Converting PKCS#1 private key to PKCS#8 format");
    return convertPkcs1ToPkcs8(pem);
  }

  return pem;
}

/**
 * Convert PKCS#1 RSA private key to PKCS#8 format.
 * Uses Node's crypto module for the conversion.
 */
function convertPkcs1ToPkcs8(pkcs1Pem: string): string {
  const crypto = require("node:crypto");
  const keyObject = crypto.createPrivateKey(pkcs1Pem);
  return keyObject
    .export({ type: "pkcs8", format: "pem" })
    .toString("utf-8")
    .trim();
}

let _auth: ReturnType<typeof createAppAuth> | undefined;

function getAuth() {
  if (!_auth) {
    const privateKey = loadPrivateKey();
    _auth = createAppAuth({
      appId: config.github.appId,
      privateKey,
    });
  }
  return _auth;
}

let _appOctokit: Octokit | undefined;

function getAppOctokit(): Octokit {
  if (!_appOctokit) {
    _appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.github.appId,
        privateKey: loadPrivateKey(),
      },
    });
  }
  return _appOctokit;
}

/**
 * Get an authenticated Octokit instance for a specific installation.
 */
export async function getOctokit(installationId: number): Promise<Octokit> {
  const auth = getAuth();
  const { token } = await auth({ type: "installation", installationId });
  return new Octokit({ auth: token });
}

/**
 * Get a raw installation token string.
 */
export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const auth = getAuth();
  const { token } = await auth({ type: "installation", installationId });
  return token;
}

/**
 * Get the authenticated app Octokit (for app-level API calls).
 */
export function getAppOctokitInstance(): Octokit {
  return getAppOctokit();
}
