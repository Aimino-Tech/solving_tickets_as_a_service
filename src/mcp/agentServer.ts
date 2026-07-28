/**
 * MCP Agent Server — JSON-RPC protocol server for agent discovery.
 *
 * Implements the Model Context Protocol (MCP) over HTTP POST at /mcp/jsonrpc
 * with tools and resources that AI agents can discover and call.
 *
 * Tools:
 *   - stas_fix_issue      — Dispatch a fix run for a GitHub issue
 *   - stas_check_status   — Check status of a fix run by runId
 *   - stas_list_runs      — List recent fix runs with optional filters
 *   - stas_get_run        — Full run details by runId
 *
 * Resources:
 *   - stas://runs/{runId}    — Full run details
 *   - stas://issues/{issueId} — Issue details with fix status
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST
 *   - tools/list, tools/call
 *   - resources/list, resources/read
 */

import { randomUUID } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { captureError } from '../monitoring/sentry.js';
import type { McpJobStatus, McpRunHistoryEntry } from '../opencode-contract.js';
import { getTracker } from '../trackers/index.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'mcp-agent-server' });

// ---------------------------------------------------------------------------
// Redis connection (singleton, shared with routes/mcp.ts pattern)
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

async function getRedis(): Promise<Redis> {
  if (!redis) {
    redis = new Redis(config.queue.redisUrl, {
      keyPrefix: 'mcp:',
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    redis.on('error', (err) => {
      log.error({ err: String(err) }, 'MCP agent Redis error');
      captureError(err instanceof Error ? err : new Error(String(err)), { service: 'mcp-agent', component: 'redis' });
    });
    await redis.connect();
  }
  return redis;
}

const JOB_TTL = 7 * 86_400; // 7 days

function redisKey(...parts: string[]): string {
  return parts.join(':');
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

// ---------------------------------------------------------------------------
// MCP type definitions
// ---------------------------------------------------------------------------

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

interface McpTextResourceContents {
  uri: string;
  mimeType: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const tools: McpTool[] = [
  {
    name: 'stas_fix_issue',
    description: 'Dispatch a STAS fix run for a GitHub issue. Returns a runId for polling status.',
    inputSchema: {
      type: 'object',
      properties: {
        repoOwner: { type: 'string', description: 'GitHub repository owner (user or org)' },
        repoName: { type: 'string', description: 'GitHub repository name' },
        issueNumber: { type: 'number', description: 'Issue number to fix' },
        model: { type: 'string', description: 'Optional model override (e.g., claude-sonnet-4)' },
      },
      required: ['repoOwner', 'repoName', 'issueNumber'],
    },
  },
  {
    name: 'stas_check_status',
    description: 'Check the current status of a STAS fix run by runId.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID returned by stas_fix_issue' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'stas_list_runs',
    description: 'List recent STAS fix runs with optional status filter.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results to return (default: 20, max: 100)' },
        status: {
          type: 'string',
          description: 'Filter by status (queued, investigating, fixing, testing, committing, completed, failed)',
        },
      },
    },
  },
  {
    name: 'stas_get_run',
    description: 'Get full details for a STAS fix run by runId.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID returned by stas_fix_issue' },
      },
      required: ['runId'],
    },
  },
];

const resources: McpResource[] = [
  {
    uri: 'stas://runs/{runId}',
    name: 'Fix Run Details',
    description: 'Full details for a STAS fix run, including status, timestamps, progress, and PR link.',
    mimeType: 'application/json',
  },
  {
    uri: 'stas://issues/{issueId}',
    name: 'Issue Fix Details',
    description: 'Issue details with fix status, run history, and linked PRs.',
    mimeType: 'application/json',
  },
];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: Router = Router();

// ---------------------------------------------------------------------------
// POST /mcp/jsonrpc — MCP JSON-RPC endpoint
// ---------------------------------------------------------------------------

router.post('/mcp/jsonrpc', async (req: Request, res: Response) => {
  const { jsonrpc, method, params, id } = req.body || {};

  if (jsonrpc !== '2.0' || !method || typeof method !== 'string') {
    res.status(400).json(jsonRpcError(id ?? null, -32600, 'Invalid Request: jsonrpc and method are required'));
    return;
  }

  try {
    switch (method) {
      case 'tools/list':
        res.json(jsonRpcResult(id, { tools }));
        return;

      case 'tools/call':
        await handleToolCall(id, params, res);
        return;

      case 'resources/list':
        res.json(jsonRpcResult(id, { resources }));
        return;

      case 'resources/read':
        await handleResourceRead(id, params, res);
        return;

      default:
        res.json(jsonRpcError(id, -32601, `Method not found: ${method}`));
    }
  } catch (err) {
    log.error({ err: String(err), method }, 'MCP JSON-RPC handler error');
    captureError(err instanceof Error ? err : new Error(String(err)), {
      service: 'mcp-agent',
      method: method || 'unknown',
    });
    res.json(jsonRpcError(id, -32603, `Internal error: ${String(err)}`));
  }
});

// ---------------------------------------------------------------------------
// Tool call dispatcher
// ---------------------------------------------------------------------------

async function handleToolCall(id: unknown, params: unknown, res: Response): Promise<void> {
  const { name, arguments: args } = (params || {}) as { name?: string; arguments?: Record<string, unknown> };

  if (!name) {
    res.json(jsonRpcError(id, -32602, 'Invalid params: name is required'));
    return;
  }

  switch (name) {
    case 'stas_fix_issue':
      await handleFixIssue(id, args, res);
      break;
    case 'stas_check_status':
      await handleCheckStatus(id, args, res);
      break;
    case 'stas_list_runs':
      await handleListRuns(id, args, res);
      break;
    case 'stas_get_run':
      await handleGetRun(id, args, res);
      break;
    default:
      res.json(jsonRpcError(id, -32601, `Tool not found: ${name}`));
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/**
 * stas_fix_issue: params = { repoOwner, repoName, issueNumber, model? }
 * Dispatches a fix run via RabbitMQ pipeline and returns a runId for polling.
 */
async function handleFixIssue(id: unknown, args: Record<string, unknown> | undefined, res: Response): Promise<void> {
  const repoOwner = args?.repoOwner as string | undefined;
  const repoName = args?.repoName as string | undefined;
  const issueNumber = args?.issueNumber as number | undefined;
  const model = args?.model as string | undefined;

  if (!repoOwner || !repoName || !issueNumber) {
    res.json(jsonRpcError(id, -32602, 'Missing required parameters: repoOwner, repoName, issueNumber'));
    return;
  }

  const runId = randomUUID();
  const now = new Date().toISOString();

  try {
    const client = await getRedis();
    const issueTitle = `Issue #${issueNumber}`;

    // Create job record in Redis
    const jobData: McpJobStatus = {
      runId,
      status: 'queued',
      message: `Fix queued for ${repoOwner}/${repoName}#${issueNumber}`,
      createdAt: now,
      updatedAt: now,
    };

    await client.setex(redisKey('job', runId), JOB_TTL, JSON.stringify(jobData));

    // Store issue-to-run mapping for resource lookups
    const issueMapKey = redisKey('issue_map', repoOwner, repoName, String(issueNumber));
    await client.sadd(issueMapKey, runId);
    await client.expire(issueMapKey, JOB_TTL);

    // Add to run history (maintain most recent 100 entries)
    const historyEntry: McpRunHistoryEntry = {
      runId,
      repoOwner,
      repoName,
      issueTitle,
      status: 'queued',
      createdAt: now,
    };

    const historyKey = redisKey('history');
    const rawHistory = await client.lrange(historyKey, 0, -1);
    const history: McpRunHistoryEntry[] = rawHistory.map((r) => JSON.parse(r));
    history.unshift(historyEntry);
    const trimmed = history.slice(0, 100);
    await client.del(historyKey);
    for (const h of trimmed) {
      await client.rpush(historyKey, JSON.stringify(h));
    }
    await client.expire(historyKey, JOB_TTL);

    // Enqueue to RabbitMQ for pipeline dispatch
    try {
      const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import('../queue/rabbitmq.js');
      if (!isConnected()) await rmqConnect();
      const messageId = `${runId}:${repoOwner}/${repoName}#${issueNumber}-${Date.now()}`;
      await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
        installationId: 0,
        repoOwner,
        repoName,
        repoPrivate: false,
        issueNumber,
        issueTitle,
        issueBody: '',
        source: 'mcp-agent',
        labels: ['stas:fix'],
        model: model || undefined,
        _meta: { messageId, enqueuedAt: now, runId },
      });
      log.info({ runId, repoOwner, repoName, issueNumber, model }, 'Fix dispatched via MCP agent');
    } catch (queueErr) {
      log.error({ err: String(queueErr), runId }, 'Failed to enqueue fix to RabbitMQ (non-fatal, run created)');
    }

    res.json(
      jsonRpcResult(id, {
        runId,
        status: 'queued',
        message: `Fix dispatched for ${repoOwner}/${repoName}#${issueNumber}`,
        createdAt: now,
      }),
    );
  } catch (err) {
    log.error({ err: String(err), repoOwner, repoName, issueNumber }, 'Failed to dispatch fix');
    res.json(jsonRpcError(id, -32603, `Failed to dispatch fix: ${String(err)}`));
  }
}

/**
 * stas_check_status: params = { runId }
 * Returns the current status of a fix run.
 */
async function handleCheckStatus(id: unknown, args: Record<string, unknown> | undefined, res: Response): Promise<void> {
  const runId = args?.runId as string | undefined;

  if (!runId) {
    res.json(jsonRpcError(id, -32602, 'Missing required parameter: runId'));
    return;
  }

  try {
    const client = await getRedis();
    const raw = await client.get(redisKey('job', runId));
    if (!raw) {
      res.json(jsonRpcError(id, -32000, `Run not found: ${runId}`));
      return;
    }
    res.json(jsonRpcResult(id, JSON.parse(raw)));
  } catch (err) {
    log.error({ err: String(err), runId }, 'Failed to check run status');
    res.json(jsonRpcError(id, -32603, `Internal error: ${String(err)}`));
  }
}

/**
 * stas_list_runs: params = { limit?, status? }
 * Lists recent fix runs with optional filters.
 */
async function handleListRuns(id: unknown, args: Record<string, unknown> | undefined, res: Response): Promise<void> {
  const rawLimit = args?.limit as number | undefined;
  const statusFilter = args?.status as string | undefined;
  const limit = Math.min(Math.max(Math.abs(Number(rawLimit) || 20), 1), 100);

  try {
    const client = await getRedis();
    const raw = await client.lrange(redisKey('history'), 0, limit - 1);
    let runs: McpRunHistoryEntry[] = raw.map((r) => JSON.parse(r));

    if (statusFilter) {
      runs = runs.filter((r) => r.status.toLowerCase() === statusFilter.toLowerCase());
    }

    res.json(jsonRpcResult(id, { runs, total: runs.length }));
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list runs');
    res.json(jsonRpcError(id, -32603, `Internal error: ${String(err)}`));
  }
}

/**
 * stas_get_run: params = { runId }
 * Returns full run details including job status and history context.
 */
async function handleGetRun(id: unknown, args: Record<string, unknown> | undefined, res: Response): Promise<void> {
  const runId = args?.runId as string | undefined;

  if (!runId) {
    res.json(jsonRpcError(id, -32602, 'Missing required parameter: runId'));
    return;
  }

  try {
    const client = await getRedis();

    // Get full job status
    const raw = await client.get(redisKey('job', runId));
    if (!raw) {
      res.json(jsonRpcError(id, -32000, `Run not found: ${runId}`));
      return;
    }

    const job = JSON.parse(raw) as McpJobStatus;

    // Augment with history context
    const historyRaw = await client.lrange(redisKey('history'), 0, -1);
    const allHistory: McpRunHistoryEntry[] = historyRaw.map((r) => JSON.parse(r));
    const historyEntry = allHistory.find((h) => h.runId === runId);

    res.json(
      jsonRpcResult(id, {
        ...job,
        repoOwner: historyEntry?.repoOwner,
        repoName: historyEntry?.repoName,
        issueTitle: historyEntry?.issueTitle,
        confidence: historyEntry?.confidence,
      }),
    );
  } catch (err) {
    log.error({ err: String(err), runId }, 'Failed to get run details');
    res.json(jsonRpcError(id, -32603, `Internal error: ${String(err)}`));
  }
}

/**
 * stas_slack_send: params = { channel, text }
 * Sends a message to a Slack channel via Slack Web API chat.postMessage.
 */
async function handleSlackSend(id: unknown, args: Record<string, unknown> | undefined, res: Response): Promise<void> {
  const channel = args?.channel as string | undefined;
  const text = args?.text as string | undefined;

  if (!channel || !text) {
    res.json(jsonRpcError(id, -32602, 'Missing required parameters: channel, text'));
    return;
  }

  const token = config.slack?.botToken;
  if (!token) {
    res.json(jsonRpcError(id, -32000, 'Slack bot token not configured (SLACK_BOT_TOKEN)'));
    return;
  }

  try {
    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, text }),
    });

    const body = await response.json() as { ok: boolean; error?: string; channel?: string; ts?: string };

    if (!response.ok || !body.ok) {
      log.error({ status: response.status, slackError: body.error, channel }, 'Slack API error');
      res.json(jsonRpcError(id, -32000, `Slack API error: ${body.error || `HTTP ${response.status}`}`));
      return;
    }

    log.info({ channel, ts: body.ts }, 'Slack message sent');
    res.json(jsonRpcResult(id, { ok: true, channel: body.channel, ts: body.ts }));
  } catch (err) {
    log.error({ err: String(err), channel }, 'Failed to send Slack message');
    res.json(jsonRpcError(id, -32603, `Slack API call failed: ${String(err)}`));
  }
}

/**
 * stas_slack_ticket: params = { title, description, priority?, channel? }
 * Creates a Linear ticket and optionally notifies a Slack channel.
 */
async function handleSlackTicket(id: unknown, args: Record<string, unknown> | undefined, res: Response): Promise<void> {
  const title = args?.title as string | undefined;
  const description = args?.description as string | undefined;
  const rawPriority = args?.priority as number | undefined;
  const channel = args?.channel as string | undefined;

  if (!title || !description) {
    res.json(jsonRpcError(id, -32602, 'Missing required parameters: title, description'));
    return;
  }

  const priority = rawPriority !== undefined ? Math.min(Math.max(Math.round(rawPriority), 0), 4) : undefined;

  try {
    const tracker = getTracker('linear');
    if (!tracker) {
      res.json(jsonRpcError(id, -32000, 'Linear tracker not configured (LINEAR_API_KEY)'));
      return;
    }

    const ticket = await tracker.createTicket({
      teamId: 'AIM',
      projectId: '7ce85efdc6bd',
      title,
      description,
      priority,
    });

    const ticketUrl = ticket.url;

    // Optionally notify Slack channel
    if (channel) {
      const token = config.slack?.botToken;
      if (token) {
        const slackText = `🎫 *New ticket created:* <${ticketUrl}|${ticket.id}: ${title}>`;
        try {
          await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ channel, text: slackText, parse_mode: 'Markdown' }),
          });
        } catch (slackErr) {
          log.warn({ err: String(slackErr), channel }, 'Failed to notify Slack channel (non-fatal)');
        }
      }
    }

    log.info({ ticketId: ticket.id, url: ticketUrl }, 'Linear ticket created via MCP agent');
    res.json(jsonRpcResult(id, { id: ticket.id, url: ticketUrl, title: ticket.title, priority: ticket.priority }));
  } catch (err) {
    log.error({ err: String(err), title }, 'Failed to create Linear ticket');
    res.json(jsonRpcError(id, -32603, `Failed to create ticket: ${String(err)}`));
  }
}

// ---------------------------------------------------------------------------
// Resource handlers
// ---------------------------------------------------------------------------

/**
 * Reads an MCP resource by URI.
 * Supports:
 *   - stas://runs/{runId}
 *   - stas://issues/{issueId}
 */
async function handleResourceRead(id: unknown, params: unknown, res: Response): Promise<void> {
  const { uri } = (params || {}) as { uri?: string };

  if (!uri || typeof uri !== 'string') {
    res.json(jsonRpcError(id, -32602, 'Invalid params: uri is required'));
    return;
  }

  try {
    const client = await getRedis();
    const contents: McpTextResourceContents[] = [];

    // stas://runs/{runId}
    const runsMatch = uri.match(/^stas:\/\/runs\/(.+)$/);
    if (runsMatch) {
      const runId = runsMatch[1];
      const raw = await client.get(redisKey('job', runId));
      if (raw) {
        contents.push({
          uri,
          mimeType: 'application/json',
          text: raw,
        });
      }
    }

    // stas://issues/{issueId} — issueId can be "owner/repo#number" or a plain issue URL
    const issuesMatch = uri.match(/^stas:\/\/issues\/(.+)$/);
    if (issuesMatch) {
      const issueId = issuesMatch[1];
      const historyRaw = await client.lrange(redisKey('history'), 0, -1);
      const allRuns: McpRunHistoryEntry[] = historyRaw.map((r) => JSON.parse(r));

      // Match runs whose issue reference contains the issueId
      const matchingRuns = allRuns.filter((r) => {
        const runRef = `${r.repoOwner}/${r.repoName}#${(r.issueTitle || '').replace('Issue #', '')}`;
        return (
          runRef === issueId || r.runId === issueId || r.issueTitle?.includes(issueId) || r.repoName?.includes(issueId)
        );
      });

      // Get full job details for matching runs
      const fullRuns: McpJobStatus[] = [];
      for (const run of matchingRuns) {
        const rawJob = await client.get(redisKey('job', run.runId));
        if (rawJob) {
          const job = JSON.parse(rawJob) as McpJobStatus;
          fullRuns.push({ ...job, prUrl: run.prUrl });
        }
      }

      contents.push({
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ issueId, totalRuns: fullRuns.length, runs: fullRuns }),
      });
    }

    if (contents.length === 0) {
      res.json(jsonRpcError(id, -32000, `Resource not found: ${uri}`));
      return;
    }

    res.json(jsonRpcResult(id, { contents }));
  } catch (err) {
    log.error({ err: String(err), uri }, 'Failed to read resource');
    res.json(jsonRpcError(id, -32603, `Internal error: ${String(err)}`));
  }
}

export default router;
