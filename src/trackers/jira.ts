import crypto from 'node:crypto';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { Ticket, Tracker } from './base.js';

const log = rootLogger.child({ module: 'tracker-jira' });

interface JiraIssueFields {
  summary?: string;
  description?:
    | {
        content?: Array<{
          content?: Array<{
            text?: string;
          }>;
        }>;
      }
    | string
    | null;
  status?: {
    name: string;
  };
  priority?: {
    id: string;
    name: string;
  } | null;
  labels?: string[];
  created?: string;
  updated?: string;
  [key: string]: unknown;
}

interface JiraIssueResponse {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

interface JiraWebhookPayload {
  webhookEvent: string;
  issue?: {
    id: string;
    key: string;
    self: string;
    fields: JiraIssueFields;
  };
  changelog?: {
    items: Array<{
      field: string;
      fromString: string | null;
      toString: string | null;
    }>;
  };
  [key: string]: unknown;
}

export class JiraTracker implements Tracker {
  readonly source = 'jira' as const;

  async createTicket(): Promise<Ticket> {
    throw new Error('Jira ticket creation not implemented in STAS monitoring loop');
  }

  private get baseUrl(): string {
    const url = config.trackers?.jira?.url;
    if (!url) throw new Error('JIRA_URL is not configured');
    return url.replace(/\/+$/, '');
  }

  private get credentials(): { email: string; apiToken: string } {
    const email = config.trackers?.jira?.email;
    const apiToken = config.trackers?.jira?.apiToken;
    if (!email || !apiToken) {
      throw new Error('JIRA_EMAIL and JIRA_API_TOKEN must be configured');
    }
    return { email, apiToken };
  }

  private async api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const { email, apiToken } = this.credentials;
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

    const response = await fetch(`${this.baseUrl}/rest/api/3${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async getTicket(id: string): Promise<Ticket> {
    const issue = await this.api<JiraIssueResponse>(`/issue/${encodeURIComponent(id)}`);

    const description = extractJiraDescription(issue.fields.description);
    const priority = parseJiraPriority(issue.fields.priority);

    return {
      id: issue.key,
      title: issue.fields.summary || '(no title)',
      description,
      status: issue.fields.status?.name || 'Unknown',
      priority,
      url: `${this.baseUrl}/browse/${issue.key}`,
      source: 'jira',
      labels: issue.fields.labels || [],
      createdAt: issue.fields.created || '',
      updatedAt: issue.fields.updated || '',
    };
  }

  async postComment(ticketId: string, body: string): Promise<void> {
    const result = await this.api<{ id: string }>(`/issue/${encodeURIComponent(ticketId)}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body: toJiraDoc(body) }),
    });

    log.info({ ticketId, commentId: result.id }, 'Comment posted to Jira');
  }

  async updateStatus(ticketId: string, statusName: string): Promise<void> {
    const transitions = await this.api<{
      transitions: Array<{ id: string; name: string; to: { name: string } }>;
    }>(`/issue/${encodeURIComponent(ticketId)}/transitions`);

    const targetTransition = transitions.transitions.find((t) => t.to.name.toLowerCase() === statusName.toLowerCase());

    if (!targetTransition) {
      throw new Error(
        `Jira transition to "${statusName}" not found for ticket ${ticketId}. ` +
          `Available transitions: ${transitions.transitions.map((t) => `${t.name} → ${t.to.name}`).join(', ')}`,
      );
    }

    await this.api(`/issue/${encodeURIComponent(ticketId)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: targetTransition.id } }),
    });

    log.info({ ticketId, newStatus: statusName }, 'Jira issue status updated');
  }

  async createLink(ticketId: string, url: string, title: string): Promise<void> {
    try {
      await this.api(`/issue/${encodeURIComponent(ticketId)}/remotelink`, {
        method: 'POST',
        body: JSON.stringify({
          object: {
            url,
            title,
            icon: {
              url16x16: 'https://github.githubassets.com/favicons/favicon.svg',
              title: 'GitHub PR',
            },
          },
        }),
      });

      log.info({ ticketId, url, title }, 'Remote link created on Jira issue');
    } catch (err) {
      log.warn({ err: String(err), ticketId, url }, 'Failed to create remote link on Jira issue');
    }
  }
}

function extractJiraDescription(desc: JiraIssueFields['description']): string | null {
  if (!desc) return null;
  if (typeof desc === 'string') return desc;

  try {
    const texts: string[] = [];
    function walk(nodes: Array<{ content?: Array<unknown>; text?: string }>) {
      for (const node of nodes) {
        if (node.text) texts.push(node.text);
        if (node.content) walk(node.content as Array<{ content?: Array<unknown>; text?: string }>);
      }
    }
    if (desc.content) {
      walk(desc.content as Array<{ content?: Array<unknown>; text?: string }>);
    }
    return texts.join('\n') || null;
  } catch {
    return JSON.stringify(desc);
  }
}

function parseJiraPriority(priority: { id: string; name: string } | null | undefined): number {
  if (!priority) return 0;
  const map: Record<string, number> = {
    highest: 1,
    high: 2,
    medium: 3,
    low: 4,
    lowest: 5,
  };
  return map[priority.name.toLowerCase()] ?? 3;
}

function toJiraDoc(text: string): unknown {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
          },
        ],
      },
    ],
  };
}

export function verifyJiraWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
  const secret = config.trackers?.jira?.webhookSecret;
  if (!secret) {
    log.warn('JIRA_WEBHOOK_SECRET not configured — skipping webhook verification');
    return true;
  }

  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const valid = crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signatureHeader));

  if (!valid) {
    log.warn('Jira webhook signature verification failed');
  }

  return valid;
}

export async function handleJiraWebhook(payload: unknown): Promise<{ ticketId: string; action: string } | null> {
  const body = payload as JiraWebhookPayload;

  if (!body.issue?.id) {
    log.warn({ payload }, 'Invalid Jira webhook payload — missing issue');
    return null;
  }

  const ticketId = body.issue.key;
  const event = body.webhookEvent || 'unknown';

  log.info({ ticketId, event, summary: body.issue.fields?.summary }, 'Jira webhook event received');

  return { ticketId, action: event };
}

export function jiraTicketToIssueData(
  ticket: Ticket,
  repoOwner: string,
  repoName: string,
  installationId: number,
  issueNumber: number,
) {
  return {
    source: 'jira' as const,
    externalId: ticket.id,
    installationId,
    repoOwner,
    repoName,
    repoPrivate: false,
    issueNumber,
    issueTitle: ticket.title,
    issueBody: ticket.description,
    trackerType: 'jira' as const,
    trackerTicketId: ticket.id,
  };
}
