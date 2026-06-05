import crypto from "node:crypto";
import type { IssueJobData } from "../utils/types.js";

export type WebhookPlatform = "github" | "gitlab" | "bitbucket";

export type WebhookEventType = "issue.labeled" | "issue.opened" | "issue.edited" | "pull_request.created";

export interface NormalizedIssue {
  id: number | string;
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  repoOwner: string;
  repoName: string;
  repoPrivate: boolean;
  installationId?: number | string;
}

export interface PlatformWebhookEvent {
  platform: WebhookPlatform;
  eventType: WebhookEventType;
  issue: NormalizedIssue;
  raw: unknown;
}

export interface PlatformWebhook {
  readonly platform: WebhookPlatform;
  verify(payload: string, signature: string, secret: string): boolean;
  parse(event: string, payload: unknown): PlatformWebhookEvent | null;
}

export interface CreatePullRequestParams {
  repoOwner: string;
  repoName: string;
  title: string;
  head: string;
  base: string;
  body: string;
  draft?: boolean;
}

export interface PlatformClient {
  readonly platform: WebhookPlatform;
  createComment(repoOwner: string, repoName: string, issueNumber: number, body: string): Promise<void>;
  createPullRequest(params: CreatePullRequestParams): Promise<{ url: string; number: number }>;
  toIssueJobData(event: PlatformWebhookEvent): IssueJobData;
}

export function verifyHmacSha256(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const received = signature.replace(/^sha256=/, "");
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function verifyToken(_payload: string, token: string, secret: string): boolean {
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, secretBuf);
}
