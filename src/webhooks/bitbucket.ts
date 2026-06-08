import crypto from 'node:crypto';

import { config } from '../config.js';
import { enqueueIssue } from '../queue/issueQueue.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import type { CreatePullRequestParams, PlatformClient, PlatformWebhook, PlatformWebhookEvent } from './base.js';

const log = rootLogger.child({ module: 'webhooks-bitbucket' });

interface BitbucketIssuePayload {
  event: 'issue:created' | 'issue:updated';
  actor: { username: string; uuid: string };
  repository: {
    uuid: string;
    name: string;
    full_name: string;
    owner: { username?: string };
    is_private: boolean;
  };
  issue: {
    id: number;
    title: string;
    content: { raw: string } | null;
    state: string;
    kind: string;
    priority: string;
    labels?: Array<{ name: string }>;
  };
}

interface BitbucketPullRequestPayload {
  event: 'pullrequest:created';
  actor: { username: string; uuid: string };
  repository: {
    uuid: string;
    name: string;
    full_name: string;
    owner: { username?: string };
    is_private: boolean;
  };
  pullrequest: {
    id: number;
    title: string;
    description: string;
    state: string;
    source: { branch: { name: string } };
    destination: { branch: { name: string } };
    links: { html: { href: string } };
  };
}

function getAuthHeader(): string {
  const encoded = Buffer.from(`${config.bitbucket.username}:${config.bitbucket.appPassword}`).toString('base64');
  return `Basic ${encoded}`;
}

export const bitbucketWebhook: PlatformWebhook = {
  platform: 'bitbucket',

  verify(payload: string, signature: string, secret: string): boolean {
    const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    const received = signature.replace(/^sha256=/, '');
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  },

  parse(_event: string, payload: unknown): PlatformWebhookEvent | null {
    const p = payload as BitbucketIssuePayload | BitbucketPullRequestPayload;

    if ('event' in p === false) return null;

    if (p.event === 'issue:created' || p.event === 'issue:updated') {
      const ip = p as BitbucketIssuePayload;
      const owner = ip.repository.owner?.username || ip.repository.full_name.split('/')[0];

      return {
        platform: 'bitbucket',
        eventType: 'issue.opened',
        issue: {
          id: ip.issue.id,
          number: ip.issue.id,
          title: ip.issue.title,
          body: ip.issue.content?.raw ?? null,
          labels: ip.issue.labels?.map((l) => l.name) ?? [],
          repoOwner: owner,
          repoName: ip.repository.name,
          repoPrivate: ip.repository.is_private,
        },
        raw: p,
      };
    }

    if (p.event === 'pullrequest:created') {
      const pr = p as BitbucketPullRequestPayload;
      const owner = pr.repository.owner?.username || pr.repository.full_name.split('/')[0];

      return {
        platform: 'bitbucket',
        eventType: 'pull_request.created',
        issue: {
          id: pr.pullrequest.id,
          number: pr.pullrequest.id,
          title: pr.pullrequest.title,
          body: pr.pullrequest.description,
          labels: [],
          repoOwner: owner,
          repoName: pr.repository.name,
          repoPrivate: pr.repository.is_private,
        },
        raw: p,
      };
    }

    return null;
  },
};

export const bitbucketClient: PlatformClient = {
  platform: 'bitbucket',

  async createComment(repoOwner: string, repoName: string, issueNumber: number, body: string): Promise<void> {
    const url = `https://api.bitbucket.org/2.0/repositories/${repoOwner}/${repoName}/issues/${issueNumber}/comments`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: { raw: body } }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(
        { status: response.status, body: text, repoOwner, repoName, issueNumber },
        'Failed to create Bitbucket comment',
      );
      throw new Error(`Bitbucket comment failed: ${response.status} ${text}`);
    }
  },

  async createPullRequest(params: CreatePullRequestParams): Promise<{ url: string; number: number }> {
    const url = `https://api.bitbucket.org/2.0/repositories/${params.repoOwner}/${params.repoName}/pullrequests`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: params.title,
        description: params.body,
        source: { branch: { name: params.head } },
        destination: { branch: { name: params.base } },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error({ status: response.status, body: text }, 'Failed to create Bitbucket pull request');
      throw new Error(`Bitbucket PR failed: ${response.status} ${text}`);
    }

    const pr = (await response.json()) as { links: { html: { href: string } }; id: number };
    return { url: pr.links.html.href, number: pr.id };
  },

  toIssueJobData(event: PlatformWebhookEvent): IssueJobData {
    return {
      installationId: Number(event.issue.installationId ?? 0),
      repoOwner: event.issue.repoOwner,
      repoName: event.issue.repoName,
      repoPrivate: event.issue.repoPrivate,
      issueNumber: event.issue.number,
      issueTitle: event.issue.title,
      issueBody: event.issue.body,
      source: 'bitbucket',
    };
  },
};

export function createBitbucketWebhooks() {
  const handler = {
    platform: 'bitbucket' as const,

    async handle(rawBody: string, signature: string): Promise<void> {
      const secret = config.bitbucket.webhookSecret;
      if (!bitbucketWebhook.verify(rawBody, signature, secret)) {
        log.warn('Bitbucket webhook signature verification failed');
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch (err) {
        log.error({ err: String(err) }, 'Failed to parse Bitbucket payload');
        return;
      }

      const event = (payload as Record<string, unknown>).event as string;
      const parsed = bitbucketWebhook.parse(event, payload);
      if (!parsed) {
        log.debug({ event }, 'Ignoring non-matching Bitbucket event');
        return;
      }

      if (event.startsWith('issue:')) {
        log.info(
          {
            repo: `${parsed.issue.repoOwner}/${parsed.issue.repoName}`,
            issueNumber: parsed.issue.number,
          },
          'Received Bitbucket issue event',
        );

        const jobData = bitbucketClient.toIssueJobData(parsed);

        try {
          await enqueueIssue(undefined, jobData);
        } catch (err) {
          log.error(
            { err: String(err), repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
            'Failed to enqueue Bitbucket issue',
          );
        }
      }
    },
  };

  return handler;
}
