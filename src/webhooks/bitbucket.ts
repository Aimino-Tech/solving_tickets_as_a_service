import crypto from 'node:crypto';

import { config } from '../config.js';
import { createBitbucketConfig } from '../platforms/bitbucket/config.js';
import { BitbucketPlatformClient } from '../platforms/bitbucket/index.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import type { CreatePullRequestParams, PlatformClient, PlatformWebhook, PlatformWebhookEvent } from './base.js';

const bbConfig = createBitbucketConfig();
const bbToken = `${bbConfig.username}:${bbConfig.appPassword}`;
export const bitbucketPlatformClient = new BitbucketPlatformClient(bbToken, bbConfig.baseUrl);

const log = rootLogger.child({ module: 'webhooks-bitbucket' });

type EnqueueHandler = (data: IssueJobData) => Promise<string | undefined>;

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

function createBitbucketPlatformClient(): BitbucketPlatformClient {
  const token = `${config.bitbucket.username}:${config.bitbucket.appPassword}`;
  return new BitbucketPlatformClient(token, config.bitbucket.baseUrl);
}

export const bitbucketClient: PlatformClient = {
  platform: 'bitbucket',

  async createComment(repoOwner: string, repoName: string, issueNumber: number, body: string): Promise<void> {
    const client = createBitbucketPlatformClient();
    await client.createComment(`${repoOwner}/${repoName}`, issueNumber, body);
  },

  async createPullRequest(params: CreatePullRequestParams): Promise<{ url: string; number: number }> {
    const client = createBitbucketPlatformClient();
    const pr = await client.createPullRequest({
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      title: params.title,
      head: params.head,
      base: params.base,
      body: params.body ?? '',
      draft: params.draft ?? false,
    });
    return { url: pr.url, number: pr.number };
  },

  toIssueJobData(event: PlatformWebhookEvent): IssueJobData {
    return {
      installationId: Number(event.issue.installationId ?? 0),
      repoOwner: event.issue.repoOwner,
      repoName: event.issue.repoName,
      repoPrivate: event.issue.repoPrivate ?? true,
      issueNumber: event.issue.number,
      issueTitle: event.issue.title,
      issueBody: event.issue.body,
      source: 'bitbucket',
    };
  },
};

export function createBitbucketWebhooks(enqueue: EnqueueHandler) {
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
        const labels = parsed.issue.labels ?? [];
        // Bitbucket emits one `issue:updated` when a label is added, so the
        // trigger-label gate runs on every issue event.
        if (!labels.includes(config.syntaro.label)) {
          log.debug(
            { label: config.syntaro.label, found: labels, issueNumber: parsed.issue.number },
            'Ignoring non-target label',
          );
          return;
        }

        log.info(
          {
            repo: `${parsed.issue.repoOwner}/${parsed.issue.repoName}`,
            issueNumber: parsed.issue.number,
            labels,
          },
          'Received Bitbucket issue event with target label',
        );

        try {
          await bitbucketClient.createComment(
            parsed.issue.repoOwner,
            parsed.issue.repoName,
            parsed.issue.number,
            '🚀 **SYNTARO is working on this issue.**\n\nA fix run has been dispatched. A draft pull request will be opened here for review once the fix is ready.',
          );
        } catch (commentErr) {
          log.warn(
            {
              err: String(commentErr),
              repo: `${parsed.issue.repoOwner}/${parsed.issue.repoName}`,
              issueNumber: parsed.issue.number,
            },
            'Failed to post "working on it" comment on Bitbucket issue',
          );
        }

        const jobData: IssueJobData = {
          repoOwner: parsed.issue.repoOwner,
          repoName: parsed.issue.repoName,
          repoPrivate: parsed.issue.repoPrivate ?? true,
          issueNumber: parsed.issue.number,
          issueTitle: parsed.issue.title,
          issueBody: parsed.issue.body ?? '',
          labels,
          installationId: Number(parsed.issue.installationId ?? 0),
          source: 'bitbucket',
        };

        try {
          await enqueue(jobData);
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
