/**
 * GitHub App authentication — installation tokens with Octokit.
 *
 * Handles PKCS#1 → PKCS#8 conversion for Node 20 / OpenSSL 3 compatibility.
 * Supports reading the private key from a file path (GITHUB_APP_PRIVATE_KEY_PATH)
 * or directly from an env var (GITHUB_APP_PRIVATE_KEY).
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ loadPrivateKey() throws clear error if both key sources are missing
 * ✅ readFileSync errors propagate with file path context
 * ✅ getOctokit() and getInstallationToken() catch auth failures with
 *    installationId in log context
 * ✅ PKCS#1→PKCS#8 conversion errors are caught with descriptive message
 * ────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
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
    try {
      pem = readFileSync(config.github.privateKeyPath, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to read private key from ${config.github.privateKeyPath}: ${String(err)}`,
      );
    }
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
  try {
    const keyObject = createPrivateKey(pkcs1Pem);
    return keyObject
      .export({ type: "pkcs8", format: "pem" })
      .toString("utf-8")
      .trim();
  } catch (err) {
    throw new Error(
      `Failed to convert PKCS#1 private key to PKCS#8: ${String(err)}`,
    );
  }
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
  try {
    const auth = getAuth();
    const { token } = await auth({ type: "installation", installationId });
    return new Octokit({ auth: token });
  } catch (err) {
    throw new Error(
      `Failed to get Octokit for installation ${installationId}: ${String(err)}`,
    );
  }
}

/**
 * Get a raw installation token string.
 */
export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  try {
    const auth = getAuth();
    const { token } = await auth({ type: "installation", installationId });
    return token;
  } catch (err) {
    throw new Error(
      `Failed to get installation token for installation ${installationId}: ${String(err)}`,
    );
  }
}

/**
 * Get the authenticated app Octokit (for app-level API calls).
 */
export function getAppOctokitInstance(): Octokit {
  return getAppOctokit();
}
