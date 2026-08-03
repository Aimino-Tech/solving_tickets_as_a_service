/**
 * AIM-3210: Webhook Delivery Helper
 *
 * Provides utility functions for sending test webhook events to the SYNTARO server.
 * Supports GitHub, GitLab, Bitbucket, Linear, and Jira webhook formats.
 *
 * Usage:
 * ```ts
 * import { sendGitHubWebhook, sendLinearWebhook } from './harness/webhook-helper.js';
 * ```
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface WebhookOptions {
  baseUrl: string;
  path?: string;
  secret?: string;
  event?: string;
  deliveryId?: string;
}

// ---------------------------------------------------------------------------
// GitHub Webhook
// ---------------------------------------------------------------------------

/**
 * Sign a payload with HMAC-SHA256 using the given secret
 * (matching GitHub's x-hub-signature-256 format).
 */
function signPayload(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/**
 * Send a GitHub-style webhook event to the SYNTARO server.
 */
export async function sendGitHubWebhook(
  baseUrl: string,
  event: string,
  payload: unknown,
  options?: Partial<WebhookOptions>,
): Promise<WebhookResponse> {
  const path = options?.path ?? '/webhook';
  const secret = options?.secret ?? 'test-webhook-secret';
  const deliveryId = options?.deliveryId ?? `test-delivery-${Date.now()}`;

  const bodyStr = JSON.stringify(payload);
  const signature = signPayload(bodyStr, secret);

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-GitHub-Delivery': deliveryId,
      'X-Hub-Signature-256': signature,
    },
    body: bodyStr,
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

/**
 * Send a GitHub webhook with an invalid signature (for auth testing).
 */
export async function sendGitHubWebhookInvalidSignature(
  baseUrl: string,
  event: string,
  payload: unknown,
  path = '/webhook',
): Promise<WebhookResponse> {
  const bodyStr = JSON.stringify(payload);

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-GitHub-Delivery': `test-delivery-${Date.now()}`,
      'X-Hub-Signature-256': 'sha256=invalid-signature-that-is-wrong',
    },
    body: bodyStr,
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

// ---------------------------------------------------------------------------
// GitLab Webhook
// ---------------------------------------------------------------------------

/**
 * Send a GitLab-style webhook event.
 */
export async function sendGitLabWebhook(
  baseUrl: string,
  event: string,
  payload: unknown,
  token?: string,
): Promise<WebhookResponse> {
  const bodyStr = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-GitLab-Event': event,
  };
  if (token) {
    headers['X-GitLab-Token'] = token;
  }

  const response = await fetch(`${baseUrl}/webhook/gitlab`, {
    method: 'POST',
    headers,
    body: bodyStr,
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

// ---------------------------------------------------------------------------
// Bitbucket Webhook
// ---------------------------------------------------------------------------

/**
 * Send a Bitbucket-style webhook event.
 */
export async function sendBitbucketWebhook(
  baseUrl: string,
  payload: unknown,
  secret?: string,
): Promise<WebhookResponse> {
  const bodyStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret ?? 'mock-bitbucket-secret');
  hmac.update(bodyStr, 'utf8');
  const signature = `sha256=${hmac.digest('hex')}`;

  const response = await fetch(`${baseUrl}/webhook/bitbucket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': signature,
    },
    body: bodyStr,
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

// ---------------------------------------------------------------------------
// Linear Webhook
// ---------------------------------------------------------------------------

/**
 * Send a Linear-style webhook event.
 */
export async function sendLinearWebhook(
  baseUrl: string,
  payload: unknown,
  secret?: string,
): Promise<WebhookResponse> {
  const bodyStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret ?? 'test-linear-secret');
  hmac.update(bodyStr, 'utf8');
  const signature = hmac.digest('hex');

  const response = await fetch(`${baseUrl}/webhook/linear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Signature': signature,
    },
    body: bodyStr,
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

// ---------------------------------------------------------------------------
// Jira Webhook
// ---------------------------------------------------------------------------

/**
 * Send a Jira-style webhook event.
 */
export async function sendJiraWebhook(
  baseUrl: string,
  payload: unknown,
  secret?: string,
): Promise<WebhookResponse> {
  const bodyStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret ?? 'test-jira-secret');
  hmac.update(bodyStr, 'utf8');
  const signature = hmac.digest('hex');

  const response = await fetch(`${baseUrl}/webhook/jira`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
    },
    body: bodyStr,
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

// ---------------------------------------------------------------------------
// Generic Webhook Sender
// ---------------------------------------------------------------------------

/**
 * Send a raw webhook request (for testing error cases).
 */
export async function sendRawWebhook(
  baseUrl: string,
  path: string,
  body: string,
  headers?: Record<string, string>,
): Promise<WebhookResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    headers: Object.fromEntries(response.headers.entries()),
  };
}
