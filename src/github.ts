/**
 * GitHub API client — creates JWT tokens, installs, posts comments, opens PRs.
 *
 * All GitHub operations go through here. Keeps webhook handlers clean.
 *
 * Flow:
 *   app JWT → get installation token → act as installation
 */

import { config } from "./config.js";

interface InstallationToken {
  token: string;
  expiresAt: string;
  repositorySelection: string;
}

// In-memory token cache keyed by installation ID
const tokenCache = new Map<string, { token: string; expiresAt: Date }>();

function base64UrlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createJwt(): Promise<string> {
  const pem = config.github.privateKey;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: config.github.appId,
  };

  const header = { alg: "RS256", typ: "JWT" };
  const encoder = new TextEncoder();
  const data = encoder.encode(
    `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(encoder.encode(JSON.stringify(payload)))}`,
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data);

  return `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(encoder.encode(JSON.stringify(payload)))}.${base64UrlEncode(signature)}`;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [\w\s]+-----/, "")
    .replace(/-----END [\w\s]+-----/, "")
    .replace(/\s/g, "");
  const bytes = atob(b64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return buf.buffer;
}

async function getInstallationToken(installationId: number): Promise<string> {
  const key = String(installationId);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > new Date()) return cached.token;

  const jwt = await createJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    { method: "POST", headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) throw new Error(`Failed to get installation token: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as InstallationToken;
  const expiresAt = new Date(data.expiresAt);
  // Refresh 5 min early
  const early = new Date(expiresAt.getTime() - 5 * 60 * 1000);
  tokenCache.set(key, { token: data.token, expiresAt: early });
  return data.token;
}

export async function postComment(installationId: number, owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
  const token = await getInstallationToken(installationId);
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) console.error("Failed to post comment:", await res.text());
}

export async function openPr(
  installationId: number,
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body: string,
  issueNumber?: number,
): Promise<string | null> {
  const token = await getInstallationToken(installationId);
  const prBody = issueNumber
    ? `${body}\n\nCloses #${issueNumber}.`
    : body;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        head,
        base,
        body: prBody,
        draft: true,
      }),
    },
  );
  if (!res.ok) {
    console.error("Failed to open PR:", await res.text());
    return null;
  }
  const data = (await res.json()) as { html_url: string };
  return data.html_url;
}
