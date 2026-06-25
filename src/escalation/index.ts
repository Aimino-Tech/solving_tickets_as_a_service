/**
 * Escalation Module — Human Escalation Path for Pipeline Failures
 *
 * Provides a generic escalation framework that routes failures through
 * multiple channels:
 *
 *   - Slack (page on-call via existing integration)
 *   - PagerDuty / Opsgenie (generic webhook-based alerting)
 *   - Linear (auto-create incident ticket)
 *
 * Escalation is silenced until explicitly acknowledged or the underlying
 * issue is resolved. All events are logged with full trace context for
 * post-mortem analysis.
 *
 * ── Design ──────────────────────────────────────────────────────────────
 * Escalation follows a configured threshold:
 *   1. After 3 consecutive retries on the same issue → Slack on-call page
 *   2. Pipeline infrastructure failure (sandbox, API, network) → Linear incident
 *   3. 'Max retries exceeded' → PagerDuty / Opsgenie alert
 *
 * Rate limiting: No more than one escalation notification per 30s per issue.
 * Silencing: Once acknowledged (via ack endpoint), further escalations for
 *   the same issue key are suppressed. Silencing is lifted when the issue
 *   is resolved or the silence TTL expires.
 * ────────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { addBreadcrumb } from '../monitoring/sentry.js';
import { getTracker } from '../trackers/index.js';
import { LinearTracker } from '../trackers/linear.js';

const log = rootLogger.child({ module: 'escalation' });

// ── Types ───────────────────────────────────────────────────────────────

export type EscalationLevel = 'info' | 'warning' | 'critical';

export type EscalationChannel = 'slack' | 'pagerduty' | 'opsgenie' | 'linear' | 'all';

export interface EscalationEvent {
  /** Unique ID for this escalation event (traceable across channels) */
  eventId: string;
  /** ISO-8601 timestamp of the escalation event */
  timestamp: string;
  /** Severity level */
  level: EscalationLevel;
  /** Which channels were / should be targeted */
  channel: EscalationChannel;
  /** Human-readable title */
  title: string;
  /** Detailed message body */
  message: string;
  /** Issue context — which issue, repo, installation */
  issueKey: string;
  /** The job / run identifier */
  jobId?: string;
  /** Which retry attempt triggered this escalation (1-based) */
  retryAttempt?: number;
  /** Pipeline failure type (sandbox, api, network) if infrastructure failure */
  pipelineFailureType?: 'sandbox' | 'api' | 'network' | 'unknown';
  /** Full error details for post-mortem */
  errorDetails?: Record<string, unknown>;
  /** GitHub issue URL for quick reference */
  issueUrl?: string;
}

export interface EscalationResult {
  eventId: string;
  channelsDelivered: EscalationChannel[];
  errors: Array<{ channel: EscalationChannel; error: string }>;
  delivered: boolean;
}

export interface EscalationState {
  /** Map issueKey -> EscalationStateEntry */
  [issueKey: string]: EscalationStateEntry;
}

export interface EscalationStateEntry {
  /** When the escalation was last sent */
  lastEscalatedAt: number;
  /** Count of escalations sent */
  escalationCount: number;
  /** Whether the escalation has been acknowledged */
  acknowledged: boolean;
  /** When (epoch ms) the acknowledgement expires */
  ackExpiresAt: number;
  /** Whether the underlying issue is resolved */
  resolved: boolean;
  /** The last event ID that was escalated */
  lastEventId: string;
  /** Full trace of escalation events for post-mortem */
  trace: Array<{
    eventId: string;
    timestamp: string;
    level: EscalationLevel;
    channel: EscalationChannel;
    message: string;
  }>;
}

// ── Configuration ───────────────────────────────────────────────────────

const ESCALATION_THRESHOLD_RETRIES = 3;
const COMMENT_RATE_LIMIT_MS = 30_000; // 30 seconds
const DEFAULT_ACK_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_TRACE_ENTRIES = 100;

// ── State ───────────────────────────────────────────────────────────────

/**
 * In-memory escalation state. In production, this should be backed by Redis
 * for persistence across restarts and multi-process accuracy.
 */
const escalationState: EscalationState = {};

/**
 * In-memory comment rate-limit tracker.
 * Maps issueKey -> timestamp of last posted comment.
 */
const commentRateLimitMap = new Map<string, number>();

// ── Event ID generation ─────────────────────────────────────────────────

function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `esc-${timestamp}-${random}`;
}

// ── Helper: build issue key ─────────────────────────────────────────────

export function buildIssueKey(repoOwner: string, repoName: string, issueNumber: number): string {
  return `${repoOwner}/${repoName}#${issueNumber}`;
}

// ── Helper: build issue URL ─────────────────────────────────────────────

export function buildIssueUrl(repoOwner: string, repoName: string, issueNumber: number): string {
  return `https://github.com/${repoOwner}/${repoName}/issues/${issueNumber}`;
}

// ── Rate limiting helpers ───────────────────────────────────────────────

/**
 * Check if we're allowed to post a comment for this issue.
 * Returns true if at least COMMENT_RATE_LIMIT_MS has elapsed since the last comment.
 */
export function canPostIssueComment(issueKey: string): boolean {
  const lastComment = commentRateLimitMap.get(issueKey);
  if (!lastComment) return true;
  return Date.now() - lastComment >= COMMENT_RATE_LIMIT_MS;
}

/**
 * Record that a comment was posted for this issue (for rate limiting).
 */
export function recordIssueComment(issueKey: string): void {
  commentRateLimitMap.set(issueKey, Date.now());
  // Clean up old entries periodically (best-effort)
  if (commentRateLimitMap.size > 10_000) {
    const now = Date.now();
    for (const [key, ts] of commentRateLimitMap.entries()) {
      if (now - ts > 3600_000) {
        commentRateLimitMap.delete(key);
      }
    }
  }
}

// ── Escalation state helpers ────────────────────────────────────────────

/**
 * Check if escalation is silenced for a given issue key.
 * Returns true if acknowledged and not expired, or if resolved.
 */
export function isEscalationSilenced(issueKey: string): boolean {
  const entry = escalationState[issueKey];
  if (!entry) return false;
  if (entry.resolved) return true;
  if (entry.acknowledged && Date.now() < entry.ackExpiresAt) return true;
  return false;
}

/**
 * Acknowledge an escalation for a given issue key.
 * This silences further escalation until ackExpiresAt or resolution.
 */
export function acknowledgeEscalation(
  issueKey: string,
  ackTtlMs: number = DEFAULT_ACK_TTL_MS,
): void {
  const entry = escalationState[issueKey];
  if (!entry) {
    log.warn({ issueKey }, 'Cannot acknowledge escalation — no state entry found');
    return;
  }
  entry.acknowledged = true;
  entry.ackExpiresAt = Date.now() + ackTtlMs;
  log.info({ issueKey, ackExpiresAt: new Date(entry.ackExpiresAt).toISOString() }, 'Escalation acknowledged');
}

/**
 * Mark an issue as resolved, lifting all escalation silencing.
 */
export function resolveEscalation(issueKey: string): void {
  const entry = escalationState[issueKey];
  if (!entry) return;
  entry.resolved = true;
  entry.acknowledged = false;
  log.info({ issueKey }, 'Escalation resolved — silencing lifted');
}

// ── Channel delivery functions ──────────────────────────────────────────

/**
 * Send an escalation to the Slack on-call channel.
 * Uses the existing Slack webhook from the alerting system.
 */
async function deliverToSlack(event: EscalationEvent): Promise<void> {
  const webhookUrl = config.slack.webhookUrl;
  if (!webhookUrl) {
    log.warn('SLACK_WEBHOOK_URL not configured — skipping Slack escalation');
    return;
  }

  const emoji = event.level === 'critical' ? ':rotating_light:' : event.level === 'warning' ? ':warning:' : ':information_source:';
  const levelTag = event.level.toUpperCase();
  const retryInfo = event.retryAttempt
    ? `\n> Retry attempt: ${event.retryAttempt}`
    : '';
  const pipelineInfo = event.pipelineFailureType
    ? `\n> Pipeline failure: \`${event.pipelineFailureType}\``
    : '';

  const text = [
    `${emoji} *[${levelTag}] Escalation: ${event.title}*`,
    `> Event: \`${event.eventId}\``,
    `> Issue: ${event.issueUrl || event.issueKey}`,
    `> ${event.message}`,
    retryInfo,
    pipelineInfo,
    event.jobId ? `> Job: \`${event.jobId}\`` : '',
    `> Timestamp: ${event.timestamp}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        channel: config.alerting.slackChannel || '#stas-alerts',
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new Error(`Slack API responded with ${response.status}: ${body}`);
    }

    log.info({ eventId: event.eventId, channel: 'slack' }, 'Slack escalation delivered');
  } catch (err) {
    log.error({ err: String(err), eventId: event.eventId }, 'Failed to deliver Slack escalation');
    throw err;
  }
}

/**
 * Send an escalation to PagerDuty via its Events API v2.
 * Requires PAGERDUTY_ROUTING_KEY env var.
 */
async function deliverToPagerDuty(event: EscalationEvent): Promise<void> {
  const routingKey = process.env.PAGERDUTY_ROUTING_KEY;
  if (!routingKey) {
    log.warn('PAGERDUTY_ROUTING_KEY not configured — skipping PagerDuty escalation');
    return;
  }

  const severityMap: Record<EscalationLevel, string> = {
    info: 'info',
    warning: 'warning',
    critical: 'critical',
  };

  const payload = {
    routing_key: routingKey,
    event_action: 'trigger',
    dedup_key: `stas-escalation-${event.issueKey}`,
    payload: {
      summary: `[STAS] ${event.title}`,
      source: 'stas-bot',
      severity: severityMap[event.level] ?? 'error',
      timestamp: event.timestamp,
      component: 'stas-pipeline',
      group: event.pipelineFailureType ?? 'retry-exhausted',
      class: 'pipeline_failure',
      custom_details: {
        eventId: event.eventId,
        issueKey: event.issueKey,
        jobId: event.jobId,
        retryAttempt: event.retryAttempt,
        pipelineFailureType: event.pipelineFailureType,
        errorDetails: event.errorDetails,
        message: event.message,
        issueUrl: event.issueUrl,
      },
    },
  };

  try {
    const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new Error(`PagerDuty API responded with ${response.status}: ${body}`);
    }

    log.info({ eventId: event.eventId, dedupKey: payload.dedup_key }, 'PagerDuty escalation delivered');
  } catch (err) {
    log.error({ err: String(err), eventId: event.eventId }, 'Failed to deliver PagerDuty escalation');
    throw err;
  }
}

/**
 * Send an escalation to Opsgenie via its Alert API v2.
 * Requires OPSGENIE_API_KEY env var.
 */
async function deliverToOpsgenie(event: EscalationEvent): Promise<void> {
  const apiKey = process.env.OPSGENIE_API_KEY;
  if (!apiKey) {
    log.warn('OPSGENIE_API_KEY not configured — skipping Opsgenie escalation');
    return;
  }

  const priorityMap: Record<EscalationLevel, string> = {
    info: 'P5',
    warning: 'P3',
    critical: 'P1',
  };

  const payload = {
    message: `[STAS] ${event.title}`,
    alias: `stas-escalation-${event.issueKey}`,
    description: event.message,
    source: 'STAS Bot',
    priority: priorityMap[event.level] ?? 'P3',
    tags: ['stas', 'pipeline-failure', event.pipelineFailureType ?? 'retry-exhausted'],
    details: {
      eventId: event.eventId,
      issueKey: event.issueKey,
      jobId: event.jobId ?? '',
      retryAttempt: String(event.retryAttempt ?? ''),
      pipelineFailureType: event.pipelineFailureType ?? '',
      errorDetails: JSON.stringify(event.errorDetails ?? {}),
      issueUrl: event.issueUrl ?? '',
    },
  };

  try {
    const response = await fetch('https://api.opsgenie.com/v2/alerts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `GenieKey ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new Error(`Opsgenie API responded with ${response.status}: ${body}`);
    }

    log.info({ eventId: event.eventId, alias: payload.alias }, 'Opsgenie escalation delivered');
  } catch (err) {
    log.error({ err: String(err), eventId: event.eventId }, 'Failed to deliver Opsgenie escalation');
    throw err;
  }
}

/**
 * Auto-create a Linear incident for pipeline infrastructure failures.
 */
async function deliverToLinear(event: EscalationEvent): Promise<void> {
  const tracker = getTracker('linear');
  if (!tracker) {
    log.warn('Linear tracker not configured — skipping Linear incident creation');
    return;
  }

  if (!(tracker instanceof LinearTracker)) {
    log.warn('Linear tracker is not a LinearTracker instance — skipping incident creation');
    return;
  }

  // Build a meaningful incident title and description
  const pipelineType = event.pipelineFailureType ?? 'unknown';
  const incidentTitle = `[STAS] Pipeline Failure: ${pipelineType} — ${event.issueKey}`;
  const incidentDescription = [
    `## Pipeline Incident — ${pipelineType.toUpperCase()}`,
    '',
    `**Event ID:** \`${event.eventId}\``,
    `**Issue:** ${event.issueUrl || event.issueKey}`,
    `**Job ID:** \`${event.jobId || 'unknown'}\``,
    `**Retry Attempt:** ${event.retryAttempt ?? 'N/A'}`,
    `**Timestamp:** ${event.timestamp}`,
    `**Level:** ${event.level}`,
    '',
    '### Error Details',
    '```json',
    JSON.stringify(event.errorDetails ?? {}, null, 2),
    '```',
    '',
    '### Message',
    event.message,
    '',
    '### Trace Events',
    '```',
    JSON.stringify(
      escalationState[event.issueKey]?.trace ?? [],
      null,
      2,
    ),
    '```',
  ].join('\n');

  try {
    // Use Linear GraphQL API directly to create an issue
    const apiKey = config.trackers?.linear?.apiKey;
    if (!apiKey) {
      log.warn('LINEAR_API_KEY not configured — cannot create Linear incident');
      return;
    }

    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: `
          mutation CreateIncident($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                id
                title
                url
              }
            }
          }
        `,
        variables: {
          input: {
            title: incidentTitle,
            description: incidentDescription,
            priority: event.level === 'critical' ? 1 : event.level === 'warning' ? 3 : 5,
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new Error(`Linear API responded with ${response.status}: ${body}`);
    }

    const result = await response.json() as {
      data?: { issueCreate?: { success: boolean; issue?: { id: string; title: string; url: string } } };
      errors?: Array<{ message: string }>;
    };

    if (result.errors?.length) {
      throw new Error(`Linear GraphQL error: ${result.errors.map((e) => e.message).join('; ')}`);
    }

    if (!result.data?.issueCreate?.success) {
      throw new Error('Linear issue creation returned unsuccessful');
    }

    log.info(
      {
        eventId: event.eventId,
        linearIssueId: result.data.issueCreate.issue?.id,
        linearIssueUrl: result.data.issueCreate.issue?.url,
      },
      'Linear incident created for pipeline failure',
    );
  } catch (err) {
    log.error({ err: String(err), eventId: event.eventId }, 'Failed to create Linear incident');
    throw err;
  }
}

/**
 * Append an event to the escalation trace for post-mortem analysis.
 */
function appendTrace(event: EscalationEvent): void {
  const entry = escalationState[event.issueKey];
  if (!entry) return;

  entry.trace.push({
    eventId: event.eventId,
    timestamp: event.timestamp,
    level: event.level,
    channel: event.channel,
    message: event.message,
  });

  // Keep trace bounded
  if (entry.trace.length > MAX_TRACE_ENTRIES) {
    entry.trace = entry.trace.slice(-MAX_TRACE_ENTRIES);
  }
}

/**
 * Get the full escalation trace for a given issue key (post-mortem).
 */
export function getEscalationTrace(issueKey: string): EscalationStateEntry['trace'] {
  return escalationState[issueKey]?.trace ?? [];
}

/**
 * Get a snapshot of all current escalation states.
 */
export function getEscalationStateSnapshot(): EscalationState {
  return { ...escalationState };
}

// ── Core escalation dispatch ────────────────────────────────────────────

/**
 * Determine the appropriate channels based on escalation level and context.
 */
function resolveChannels(
  level: EscalationLevel,
  pipelineFailureType?: string,
): EscalationChannel[] {
  const channels: EscalationChannel[] = [];

  // Slack is always included for warning+ levels
  if (level === 'warning' || level === 'critical') {
    channels.push('slack');
  }

  // Pipeline infrastructure failures always create a Linear incident
  if (pipelineFailureType && ['sandbox', 'api', 'network'].includes(pipelineFailureType)) {
    channels.push('linear');
  }

  // Critical level always pages PagerDuty (or Opsgenie if configured)
  if (level === 'critical') {
    if (process.env.PAGERDUTY_ROUTING_KEY) {
      channels.push('pagerduty');
    }
    if (process.env.OPSGENIE_API_KEY) {
      channels.push('opsgenie');
    }
  }

  return channels;
}

/**
 * Dispatch an escalation event through all configured channels.
 *
 * This is the main entry point for escalation. It handles:
 * - Rate limiting (no more than one escalation per issue per 30s)
 * - Silencing (acknowledged or resolved issues are not escalated)
 * - Channel routing based on level and failure type
 * - Full trace logging for post-mortem
 * - Returns a result with delivery status per channel
 */
export async function dispatchEscalation(event: EscalationEvent): Promise<EscalationResult> {
  const result: EscalationResult = {
    eventId: event.eventId,
    channelsDelivered: [],
    errors: [],
    delivered: false,
  };

  // Check silencing
  if (isEscalationSilenced(event.issueKey)) {
    log.info(
      { issueKey: event.issueKey, eventId: event.eventId },
      'Escalation silenced — skipping delivery (acknowledged or resolved)',
    );
    result.delivered = true; // Silenced is considered "handled"
    return result;
  }

  // Resolve channels
  const channels = resolveChannels(event.level, event.pipelineFailureType);

  // Validate we have at least one channel
  if (channels.length === 0) {
    log.warn(
      { eventId: event.eventId, level: event.level },
      'No escalation channels configured for this event level — escalation not delivered',
    );
    return result;
  }

  // Update state before delivery
  const existingEntry = escalationState[event.issueKey];
  escalationState[event.issueKey] = {
    ...(existingEntry ?? {
      lastEscalatedAt: 0,
      escalationCount: 0,
      acknowledged: false,
      ackExpiresAt: 0,
      resolved: false,
      lastEventId: '',
      trace: [],
    }),
    lastEscalatedAt: Date.now(),
    escalationCount: (existingEntry?.escalationCount ?? 0) + 1,
    lastEventId: event.eventId,
  };

  // Append trace
  appendTrace(event);

  // Log the escalation event
  log.warn(
    {
      eventId: event.eventId,
      issueKey: event.issueKey,
      level: event.level,
      channels,
      retryAttempt: event.retryAttempt,
      pipelineFailureType: event.pipelineFailureType,
      jobId: event.jobId,
      title: event.title,
    },
    `Escalation event: ${event.title}`,
  );

  // Sentry breadcrumb
  addBreadcrumb(
    `escalation.${event.level}`,
    `[${event.level.toUpperCase()}] ${event.title}`,
    {
      eventId: event.eventId,
      issueKey: event.issueKey,
      channels: channels.join(','),
      retryAttempt: String(event.retryAttempt ?? ''),
      pipelineFailureType: event.pipelineFailureType,
      jobId: event.jobId,
    },
  );

  // Deliver to each channel in parallel
  const deliveryPromises = channels.map(async (channel) => {
    try {
      switch (channel) {
        case 'slack':
          await deliverToSlack(event);
          break;
        case 'pagerduty':
          await deliverToPagerDuty(event);
          break;
        case 'opsgenie':
          await deliverToOpsgenie(event);
          break;
        case 'linear':
          await deliverToLinear(event);
          break;
      }
      result.channelsDelivered.push(channel);
    } catch (err) {
      result.errors.push({ channel, error: String(err) });
    }
  });

  await Promise.all(deliveryPromises);

  // If at least one channel succeeded, mark as delivered
  result.delivered = result.channelsDelivered.length > 0;

  return result;
}

// ── High-level escalation triggers ──────────────────────────────────────

/**
 * Trigger an escalation after 3 consecutive retries on the same issue.
 * Pages on-call via Slack and creates a warning-level event.
 */
export async function escalateRetryExhaustion(params: {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  jobId?: string;
  retryAttempt: number;
  lastError: string;
  errorDetails?: Record<string, unknown>;
}): Promise<EscalationResult> {
  const issueKey = buildIssueKey(params.repoOwner, params.repoName, params.issueNumber);
  const issueUrl = buildIssueUrl(params.repoOwner, params.repoName, params.issueNumber);

  const event: EscalationEvent = {
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
    level: 'warning',
    channel: 'slack',
    title: `Retry #${params.retryAttempt} exhausted for ${issueKey}`,
    message: `Job ${params.jobId ?? 'unknown'} exhausted retry #${params.retryAttempt}. Last error: ${params.lastError}`,
    issueKey,
    jobId: params.jobId,
    retryAttempt: params.retryAttempt,
    errorDetails: params.errorDetails,
    issueUrl,
  };

  return dispatchEscalation(event);
}

/**
 * Trigger a critical escalation when max retries are exceeded.
 * Fires PagerDuty/Opsgenie alert and pages on-call via Slack.
 */
export async function escalateMaxRetriesExceeded(params: {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  jobId?: string;
  retryCount: number;
  maxRetries: number;
  lastError: string;
  errorDetails?: Record<string, unknown>;
}): Promise<EscalationResult> {
  const issueKey = buildIssueKey(params.repoOwner, params.repoName, params.issueNumber);
  const issueUrl = buildIssueUrl(params.repoOwner, params.repoName, params.issueNumber);

  const event: EscalationEvent = {
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
    level: 'critical',
    channel: 'all',
    title: `Max retries exceeded for ${issueKey}`,
    message: `Job ${params.jobId ?? 'unknown'} exceeded max retries (${params.retryCount}/${params.maxRetries}). Last error: ${params.lastError}. The job has been moved to the dead-letter queue.`,
    issueKey,
    jobId: params.jobId,
    retryAttempt: params.retryCount,
    errorDetails: params.errorDetails,
    issueUrl,
  };

  return dispatchEscalation(event);
}

/**
 * Trigger an escalation for a pipeline infrastructure failure.
 * Auto-creates a Linear incident and pages on-call.
 */
export async function escalatePipelineFailure(params: {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  jobId?: string;
  failureType: 'sandbox' | 'api' | 'network' | 'unknown';
  error: string;
  errorDetails?: Record<string, unknown>;
}): Promise<EscalationResult> {
  const issueKey = buildIssueKey(params.repoOwner, params.repoName, params.issueNumber);
  const issueUrl = buildIssueUrl(params.repoOwner, params.repoName, params.issueNumber);

  const event: EscalationEvent = {
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
    level: 'critical',
    channel: 'all',
    title: `Pipeline ${params.failureType} failure for ${issueKey}`,
    message: `Pipeline infrastructure failure (${params.failureType}) for job ${params.jobId ?? 'unknown'}: ${params.error}`,
    issueKey,
    jobId: params.jobId,
    pipelineFailureType: params.failureType,
    errorDetails: params.errorDetails,
    issueUrl,
  };

  return dispatchEscalation(event);
}

/**
 * Create a generic escalation event with full control over parameters.
 */
export async function escalateGeneric(params: EscalationEvent): Promise<EscalationResult> {
  return dispatchEscalation(params);
}

// ── HTTP handler for acknowledgement (for Slack buttons / API) ──────────

/**
 * Create an Express-compatible middleware that handles escalation ack requests.
 *
 * Accepts POST requests to `/api/v1/escalation/ack/:issueKey` with an
 * optional `ackTtlMs` body parameter.
 */
export async function escalationAckHandler(
  req: { params: { issueKey?: string }; body?: { ackTtlMs?: number } },
  res: { status: (code: number) => { json: (data: unknown) => void } },
): Promise<void> {
  const { issueKey } = req.params;
  if (!issueKey) {
    res.status(400).json({ error: 'Missing issueKey parameter' });
    return;
  }

  acknowledgeEscalation(issueKey, req.body?.ackTtlMs);
  res.status(200).json({
    acknowledged: true,
    issueKey,
    silencedUntil: new Date(Date.now() + (req.body?.ackTtlMs ?? DEFAULT_ACK_TTL_MS)).toISOString(),
  });
}

/**
 * Create an Express-compatible middleware that handles escalation resolve requests.
 *
 * Accepts POST requests to `/api/v1/escalation/resolve/:issueKey`.
 */
export async function escalationResolveHandler(
  req: { params: { issueKey?: string } },
  res: { status: (code: number) => { json: (data: unknown) => void } },
): Promise<void> {
  const { issueKey } = req.params;
  if (!issueKey) {
    res.status(400).json({ error: 'Missing issueKey parameter' });
    return;
  }

  resolveEscalation(issueKey);
  res.status(200).json({
    resolved: true,
    issueKey,
  });
}

/**
 * Get the escalation trace for a given issue key (for post-mortem API).
 */
export async function escalationTraceHandler(
  req: { params: { issueKey?: string } },
  res: { status: (code: number) => { json: (data: unknown) => void } },
): Promise<void> {
  const { issueKey } = req.params;
  if (!issueKey) {
    res.status(400).json({ error: 'Missing issueKey parameter' });
    return;
  }

  const trace = getEscalationTrace(issueKey);
  const state = escalationState[issueKey] ?? null;

  res.status(200).json({
    issueKey,
    trace,
    state,
  });
}

// ── Post-mortem: get all traces ─────────────────────────────────────────

/**
 * Get the full escalation state for post-mortem analysis.
 * Useful for generating incident reports.
 */
export function getPostMortemData(): {
  state: EscalationState;
  summary: {
    totalEscalations: number;
    activeEscalations: number;
    acknowledged: number;
    resolved: number;
    totalTraceEntries: number;
  };
} {
  const entries = Object.values(escalationState);
  const summary = {
    totalEscalations: entries.length,
    activeEscalations: entries.filter((e) => !e.resolved && !e.acknowledged).length,
    acknowledged: entries.filter((e) => e.acknowledged && !e.resolved).length,
    resolved: entries.filter((e) => e.resolved).length,
    totalTraceEntries: entries.reduce((sum, e) => sum + e.trace.length, 0),
  };

  return { state: { ...escalationState }, summary };
}
