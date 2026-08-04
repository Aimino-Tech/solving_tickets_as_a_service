import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import type { CreatePullRequestParams, PlatformClient, PlatformWebhook, PlatformWebhookEvent } from './base.js';
import { verifyToken } from './base.js';

const log = rootLogger.child({ module: 'webhooks-gitlab' });

type EnqueueHandler = (data: IssueJobData) => Promise<string | undefined>;

interface GitLabIssuePayload {
  object_kind: 'issue';
  event_type: 'issue';
  user: { username: string; id: number };
  project: {
    id: number;
    name: string;
    namespace: string;
    path_with_namespace: string;
    visibility_level: number;
    web_url: string;
  };
  object_attributes: {
    id: number;
    iid: number;
    title: string;
    description: string;
    state: string;
    url: string;
    action: 'open' | 'update' | 'close' | 'reopen';
    labels: Array<{ title: string }>;
  };
  labels?: Array<{ title: string }>;
}

interface GitLabMergeRequestBody {
  object_kind: 'merge_request';
  event_type: 'merge_request';
  project: {
    id: number;
    name: string;
    namespace: string;
    path_with_namespace: string;
    visibility_level: number;
  };
  object_attributes: {
    id: number;
    iid: number;
    title: string;
    description: string;
    state: string;
    action: 'open' | 'update' | 'merge' | 'close';
    source_branch: string;
    target_branch: string;
    url: string;
  };
}

export const gitlabWebhook: PlatformWebhook = {
  platform: 'gitlab',

  verify(_payload: string, token: string, secret: string): boolean {
    return verifyToken(_payload, token, secret);
  },

  parse(event: string, payload: unknown): PlatformWebhookEvent | null {
    if (event === 'Issue Hook') {
      const p = payload as GitLabIssuePayload;
      if (p.object_kind !== 'issue') return null;

      const action = p.object_attributes.action;
      let eventType: PlatformWebhookEvent['eventType'];

      if (action === 'open') {
        eventType = 'issue.opened';
      } else if (action === 'update') {
        const labels = p.object_attributes.labels ?? [];
        const hasTargetLabel = labels.some((l) => l.title === config.syntaro.label);
        if (hasTargetLabel) {
          eventType = 'issue.edited';
        } else {
          return null;
        }
      } else {
        return null;
      }

      return {
        platform: 'gitlab',
        eventType,
        issue: {
          id: p.object_attributes.id,
          number: p.object_attributes.iid,
          title: p.object_attributes.title,
          body: p.object_attributes.description,
          labels: (p.object_attributes.labels ?? []).map((l) => l.title),
          repoOwner: p.project.namespace,
          repoName: p.project.name,
          repoPrivate: p.project.visibility_level !== 0,
        },
        raw: p,
      };
    }

    if (event === 'Merge Request Hook') {
      const p = payload as GitLabMergeRequestBody;
      if (p.object_kind !== 'merge_request') return null;

      if (p.object_attributes.action === 'open') {
        return {
          platform: 'gitlab',
          eventType: 'pull_request.created',
          issue: {
            id: p.object_attributes.id,
            number: p.object_attributes.iid,
            title: p.object_attributes.title,
            body: p.object_attributes.description,
            labels: [],
            repoOwner: p.project.namespace,
            repoName: p.project.name,
            repoPrivate: p.project.visibility_level !== 0,
          },
          raw: p,
        };
      }
      return null;
    }

    return null;
  },
};

export const gitlabClient: PlatformClient = {
  platform: 'gitlab',

  async createComment(repoOwner: string, repoName: string, issueNumber: number, body: string): Promise<void> {
    const projectEncoded = encodeURIComponent(`${repoOwner}/${repoName}`);
    const url = `${config.gitlab.url}/api/v4/projects/${projectEncoded}/issues/${issueNumber}/notes`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': config.gitlab.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(
        { status: response.status, body: text, repoOwner, repoName, issueNumber },
        'Failed to create GitLab comment',
      );
      throw new Error(`GitLab comment failed: ${response.status} ${text}`);
    }
  },

  async createPullRequest(params: CreatePullRequestParams): Promise<{ url: string; number: number }> {
    const projectEncoded = encodeURIComponent(`${params.repoOwner}/${params.repoName}`);
    const url = `${config.gitlab.url}/api/v4/projects/${projectEncoded}/merge_requests`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': config.gitlab.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_branch: params.head,
        target_branch: params.base,
        title: params.title,
        description: params.body,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error({ status: response.status, body: text }, 'Failed to create GitLab merge request');
      throw new Error(`GitLab MR failed: ${response.status} ${text}`);
    }

    const mr = (await response.json()) as { web_url: string; iid: number };
    return { url: mr.web_url, number: mr.iid };
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
      source: 'gitlab',
    };
  },
};

export function createGitlabWebhooks(enqueue: EnqueueHandler) {
  const handler = {
    platform: 'gitlab' as const,

    async handle(event: string, payload: unknown): Promise<void> {
      const parsed = gitlabWebhook.parse(event, payload);
      if (!parsed) {
        log.debug({ event }, 'Ignoring non-matching GitLab event');
        return;
      }

      if (parsed.eventType === 'issue.labeled' || parsed.eventType === 'issue.edited') {
        const labels = parsed.issue.labels;
        if (!labels.includes(config.syntaro.label)) {
          log.debug({ label: config.syntaro.label, found: labels }, 'Ignoring non-target label');
          return;
        }

        log.info(
          {
            repo: `${parsed.issue.repoOwner}/${parsed.issue.repoName}`,
            issueNumber: parsed.issue.number,
            label: config.syntaro.label,
          },
          "Received GitLab issue event with target label",
        );

        const jobData = gitlabClient.toIssueJobData(parsed);

        try {
          await enqueue(jobData);
        } catch (err) {
          log.error(
            { err: String(err), repo: `${jobData.repoOwner}/${jobData.repoName}`, issueNumber: jobData.issueNumber },
            'Failed to enqueue GitLab issue',
          );
        }
      }
    },
  };

  return handler;
}
