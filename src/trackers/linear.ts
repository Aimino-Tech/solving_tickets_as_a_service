import crypto from "node:crypto";
import { config } from "../config.js";
import { rootLogger } from "../utils/logger.js";
import type { Tracker, Ticket } from "./base.js";

const log = rootLogger.child({ module: "tracker-linear" });

const LINEAR_API_URL = "https://api.linear.app/graphql";

interface LinearWebhookPayload {
  action: "create" | "update" | "delete";
  data: {
    id: string;
    title?: string;
    description?: string | null;
    priority?: number;
    priorityLabel?: string;
    state?: { name: string; type: string };
    labels?: Array<{ name: string }>;
    team?: { id: string; name: string; key: string };
    project?: { id: string; name: string };
    createdAt?: string;
    updatedAt?: string;
    url?: string;
    [key: string]: unknown;
  };
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class LinearTracker implements Tracker {
  readonly source = "linear" as const;

  private async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const apiKey = config.trackers?.linear?.apiKey;
    if (!apiKey) {
      throw new Error("LINEAR_API_KEY is not configured");
    }

    const response = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Linear API error (${response.status}): ${text}`);
    }

    const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

    if (body.errors?.length) {
      throw new Error(`Linear GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
    }

    return body.data as T;
  }

  async getTicket(id: string): Promise<Ticket> {
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          title
          description
          priority
          url
          state { name type }
          labels { nodes { name } }
          createdAt
          updatedAt
        }
      }
    `;

    interface IssueResponse {
      issue: {
        id: string;
        title: string;
        description: string | null;
        priority: number;
        url: string;
        state: { name: string; type: string };
        labels: { nodes: Array<{ name: string }> };
        createdAt: string;
        updatedAt: string;
      } | null;
    }

    const result = await this.graphql<IssueResponse>(query, { id });

    if (!result.issue) {
      throw new Error(`Linear issue not found: ${id}`);
    }

    return {
      id: result.issue.id,
      title: result.issue.title,
      description: result.issue.description,
      status: result.issue.state.name,
      priority: result.issue.priority,
      url: result.issue.url,
      source: "linear",
      labels: result.issue.labels.nodes.map((l) => l.name),
      createdAt: result.issue.createdAt,
      updatedAt: result.issue.updatedAt,
    };
  }

  async postComment(ticketId: string, body: string): Promise<void> {
    const mutation = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id }
        }
      }
    `;

    const result = await this.graphql<{
      commentCreate: { success: boolean; comment: { id: string } };
    }>(mutation, {
      input: {
        issueId: ticketId,
        body,
      },
    });

    if (!result.commentCreate.success) {
      throw new Error(`Failed to post comment on Linear issue ${ticketId}`);
    }

    log.info(
      { ticketId, commentId: result.commentCreate.comment.id },
      "Comment posted to Linear",
    );
  }

  async updateStatus(ticketId: string, statusName: string): Promise<void> {
    const stateQuery = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          team { id }
        }
      }
    `;

    interface StateResult {
      issue: { id: string; team: { id: string } } | null;
    }

    const result = await this.graphql<StateResult>(stateQuery, { id: ticketId });

    if (!result.issue) {
      throw new Error(`Linear issue not found: ${ticketId}`);
    }

    const workflowStatesQuery = `
      query GetTeamStates($teamId: String!) {
        team(id: $teamId) {
          states { nodes { id name type } }
        }
      }
    `;

    interface StatesResult {
      team: {
        states: { nodes: Array<{ id: string; name: string; type: string }> };
      } | null;
    }

    const statesResult = await this.graphql<StatesResult>(workflowStatesQuery, {
      teamId: result.issue.team.id,
    });

    if (!statesResult.team) {
      throw new Error(`Linear team not found for issue ${ticketId}`);
    }

    const targetState = statesResult.team.states.nodes.find(
      (s) => s.name.toLowerCase() === statusName.toLowerCase(),
    );

    if (!targetState) {
      throw new Error(
        `Linear state "${statusName}" not found for ticket ${ticketId}. ` +
          `Available states: ${statesResult.team.states.nodes.map((s) => s.name).join(", ")}`,
      );
    }

    const mutation = `
      mutation UpdateIssue($input: IssueUpdateInput!, $id: String!) {
        issueUpdate(input: $input, id: $id) {
          success
        }
      }
    `;

    const updateResult = await this.graphql<{
      issueUpdate: { success: boolean };
    }>(mutation, {
      id: ticketId,
      input: { stateId: targetState.id },
    });

    if (!updateResult.issueUpdate.success) {
      throw new Error(`Failed to update status of Linear issue ${ticketId}`);
    }

    log.info(
      { ticketId, oldStatus: undefined, newStatus: statusName },
      "Linear issue status updated",
    );
  }

  async createLink(ticketId: string, url: string, title: string): Promise<void> {
    const mutation = `
      mutation CreateAttachmentLink($input: AttachmentCreateInput!) {
        attachmentCreate(input: $input) {
          success
        }
      }
    `;

    try {
      await this.graphql(mutation, {
        input: {
          issueId: ticketId,
          title,
          url,
        },
      });

      log.info({ ticketId, url, title }, "Link created on Linear issue");
    } catch (err) {
      log.warn(
        { err: String(err), ticketId, url },
        "Failed to create attachment link on Linear issue",
      );
    }
  }
}

export function verifyLinearWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string,
): boolean {
  const secret = config.trackers?.linear?.webhookSecret;
  if (!secret) {
    log.warn("LINEAR_WEBHOOK_SECRET not configured — skipping webhook verification");
    return true;
  }

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const expectedSignature = signatureHeader.slice(prefix.length);
  const computedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const valid = crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(expectedSignature),
  );

  if (!valid) {
    log.warn("Linear webhook signature verification failed");
  }

  return valid;
}

export async function handleLinearWebhook(
  payload: unknown,
): Promise<{ ticketId: string; action: string } | null> {
  const body = payload as LinearWebhookPayload;

  if (!body.data?.id) {
    log.warn({ payload }, "Invalid Linear webhook payload — missing data.id");
    return null;
  }

  const ticketId = body.data.id;
  const action = body.action || "update";

  log.info(
    { ticketId, action, title: body.data.title },
    "Linear webhook event received",
  );

  return { ticketId, action };
}

export function linearTicketToIssueData(
  ticket: Ticket,
  repoOwner: string,
  repoName: string,
  installationId: number,
  issueNumber: number,
) {
  return {
    source: "linear" as const,
    externalId: ticket.id,
    installationId,
    repoOwner,
    repoName,
    repoPrivate: false,
    issueNumber,
    issueTitle: ticket.title,
    issueBody: ticket.description,
    trackerType: "linear" as const,
    trackerTicketId: ticket.id,
  };
}
