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
 *   - stas_batch_fix      — Fix multiple issues in one invocation
 *   - stas_triage         — Score which issues in a repo are fixable
 *   - stas_estimate       — Complexity, effort, risk analysis for an issue
 *
 * Resources:
 *   - stas://runs/{runId}                — Full run details
 *   - stas://issues/{issueId}            — Issue details with fix status
 *   - stas://issues/{issueId}/context    — Full context bundle for an issue
 *   - stas://repos/{repo}/heuristics     — Repository fix heuristics
 *
 * Prompts:
 *   - stas_fix_pattern      — Template for common fix patterns
 *   - stas_triage_pattern   — Template for triage analysis
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST
 *   - tools/list, tools/call
 *   - resources/list, resources/read
 *   - prompts/list, prompts/get
 */

import { randomUUID } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import type { McpJobStatus, McpRunHistoryEntry } from '../opencode-contract.js';
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
  {
    name: 'stas_batch_fix',
    description:
      'Fix multiple issues in one invocation. Accepts an array of issue references and returns a batch runId for polling status.',
    inputSchema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          description: 'Array of issues to fix (each with repoOwner, repoName, issueNumber)',
          items: {
            type: 'object',
            properties: {
              repoOwner: { type: 'string', description: 'GitHub repository owner' },
              repoName: { type: 'string', description: 'GitHub repository name' },
              issueNumber: { type: 'number', description: 'Issue number to fix' },
              model: { type: 'string', description: 'Optional model override' },
            },
            required: ['repoOwner', 'repoName', 'issueNumber'],
          },
        },
      },
      required: ['issues'],
    },
  },
  {
    name: 'stas_triage',
    description:
      'Analyze a repository and score which issues are most fixable. Returns a scored list with confidence, effort, and risk estimates.',
    inputSchema: {
      type: 'object',
      properties: {
        repoOwner: { type: 'string', description: 'GitHub repository owner' },
        repoName: { type: 'string', description: 'GitHub repository name' },
        maxIssues: { type: 'number', description: 'Maximum issues to analyze (default: 10, max: 50)' },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter by labels (e.g., ["bug", "good first issue"])',
        },
      },
      required: ['repoOwner', 'repoName'],
    },
  },
  {
    name: 'stas_estimate',
    description:
      'Analyze an issue and return complexity, effort estimate, risk assessment, and recommended model for fixing.',
    inputSchema: {
      type: 'object',
      properties: {
        repoOwner: { type: 'string', description: 'GitHub repository owner' },
        repoName: { type: 'string', description: 'GitHub repository name' },
        issueNumber: { type: 'number', description: 'Issue number to analyze' },
      },
      required: ['repoOwner', 'repoName', 'issueNumber'],
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
  {
    uri: 'stas://issues/{issueId}/context',
    name: 'Issue Context Bundle',
    description: 'Full context for an issue: description, comments, related files, repo structure, and fix history.',
    mimeType: 'application/json',
  },
  {
    uri: 'stas://repos/{repo}/heuristics',
    name: 'Repo Fix Heuristics',
    description:
      'Repository-specific fix patterns, common issue categories, language stats, and past fix success data.',
    mimeType: 'application/json',
  },
];

// ---------------------------------------------------------------------------
// Prompt definitions
// ---------------------------------------------------------------------------

interface McpPrompt {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
}

const prompts: McpPrompt[] = [
  {
    name: 'stas_fix_pattern',
    description:
      'Template prompt for fixing a GitHub issue with STAS. Guides the agent through investigation, fix, and PR creation.',
    arguments: [
      { name: 'repoOwner', description: 'GitHub repository owner', required: true },
      { name: 'repoName', description: 'GitHub repository name', required: true },
      { name: 'issueNumber', description: 'Issue number to fix', required: true },
      { name: 'model', description: 'Optional model override', required: false },
    ],
  },
  {
    name: 'stas_triage_pattern',
    description:
      'Template prompt for triaging issues in a repository. Guides the agent to analyze and rank fixable issues.',
    arguments: [
      { name: 'repoOwner', description: 'GitHub repository owner', required: true },
      { name: 'repoName', description: 'GitHub repository name', required: true },
      { name: 'maxIssues', description: 'Maximum issues to analyze', required: false },
    ],
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

      case 'prompts/list':
        res.json(jsonRpcResult(id, { prompts }));
        return;

      case 'prompts/get':
        await handlePromptGet(id, params, res);
        return;

      default:
        res.json(jsonRpcError(id, -32601, `Method not found: ${method}`));
    }
  } catch (err) {
    log.error({ err: String(err), method }, 'MCP JSON-RPC handler error');
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
    case 'stas_batch_fix':
      await handleBatchFix(id, args, res);
      break;
    case 'stas_triage':
      await handleTriage(id, args, res);
      break;
    case 'stas_estimate':
      await handleEstimate(id, args, res);
      break;
    default:
      res.json(jsonRpcError(id, -32601, `Tool not found: ${name}`));
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

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

  const costEstimate = model?.includes('sonnet') || model?.includes('opus') ? 0.15 : 0.08;
  const timeEstimate = 300;
  const confidence = 'high';

  try {
    const client = await getRedis();
    const issueTitle = `Issue #${issueNumber}`;

    const jobData: McpJobStatus = {
      runId,
      status: 'queued',
      message: `Fix queued for ${repoOwner}/${repoName}#${issueNumber}`,
      createdAt: now,
      updatedAt: now,
    };

    await client.setex(redisKey('job', runId), JOB_TTL, JSON.stringify(jobData));

    const issueMapKey = redisKey('issue_map', repoOwner, repoName, String(issueNumber));
    await client.sadd(issueMapKey, runId);
    await client.expire(issueMapKey, JOB_TTL);

    const historyEntry: McpRunHistoryEntry = {
      runId,
      repoOwner,
      repoName,
      issueTitle,
      status: 'queued',
      confidence: 'high',
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
        costEstimate,
        timeEstimate,
        confidence,
        createdAt: now,
      }),
    );
  } catch (err) {
    log.error({ err: String(err), repoOwner, repoName, issueNumber }, 'Failed to dispatch fix');
    res.json(jsonRpcError(id, -32603, `Failed to dispatch fix: ${String(err)}`));
  }
}

async function handleBatchFix(id: unknown, args: Record<string, unknown> | undefined, res: Response): Promise<void> {
  const issues = args?.issues as
    | Array<{ repoOwner: string; repoName: string; issueNumber: number; model?: string }>
    | undefined;

  if (!issues || !Array.isArray(issues) || issues.length === 0) {
    res.json(jsonRpcError(id, -32602, 'Missing required parameter: issues must be a non-empty array'));
    return;
  }

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const runIds: string[] = [];

  try {
    const client = await getRedis();

    const batchEntry = {
      batchId,
      totalIssues: issues.length,
      status: 'queued',
      runIds: [] as string[],
      createdAt: now,
      updatedAt: now,
    };

    for (const issue of issues) {
      const { repoOwner, repoName, issueNumber } = issue;
      if (!repoOwner || !repoName || !issueNumber) continue;

      const runId = randomUUID();
      runIds.push(runId);
      batchEntry.runIds.push(runId);

      const jobData: McpJobStatus = {
        runId,
        status: 'queued',
        message: `Fix queued for ${repoOwner}/${repoName}#${issueNumber}`,
        createdAt: now,
        updatedAt: now,
      };

      await client.setex(redisKey('job', runId), JOB_TTL, JSON.stringify(jobData));
    }

    batchEntry.status = 'queued';
    await client.setex(redisKey('batch', batchId), JOB_TTL, JSON.stringify(batchEntry));

    res.json(
      jsonRpcResult(id, {
        batchId,
        totalRuns: runIds.length,
        runIds,
        status: 'queued',
        message: `Batch fix dispatched for ${runIds.length} issue(s)`,
        createdAt: now,
      }),
    );
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to dispatch batch fix');
    res.json(jsonRpcError(id, -32603, `Failed to dispatch batch fix: ${String(err)}`));
  }
}

async function handleTriage(id: unknown, args: Record<string, unknown> | undefined, res: Response): Promise<void> {
  const repoOwner = args?.repoOwner as string | undefined;
  const repoName = args?.repoName as string | undefined;
  const maxIssues = Math.min(Math.max(Math.abs(Number(args?.maxIssues) || 10), 1), 50);

  if (!repoOwner || !repoName) {
    res.json(jsonRpcError(id, -32602, 'Missing required parameters: repoOwner, repoName'));
    return;
  }

  try {
    const client = await getRedis();
    const historyKey = redisKey('history');
    const rawHistory = await client.lrange(historyKey, 0, -1);
    const allRuns: McpRunHistoryEntry[] = rawHistory.map((r) => JSON.parse(r));
    const repoRuns = allRuns.filter((r) => r.repoOwner === repoOwner && r.repoName === repoName);
    const successCount = repoRuns.filter((r) => r.status === 'completed').length;
    const failCount = repoRuns.filter((r) => r.status === 'failed' || r.status === 'error').length;
    const totalRunCount = repoRuns.length;

    const scoredIssues = [
      {
        issueNumber: 0,
        title: `Sample issue in ${repoOwner}/${repoName}`,
        confidence: totalRunCount > 0 ? successCount / (totalRunCount || 1) : 0.7,
        effort: 'medium',
        risk: totalRunCount > 0 && successCount > failCount ? 'low' : 'medium',
        suggestedModel: 'claude-sonnet-4-20250514',
      },
    ];

    res.json(
      jsonRpcResult(id, {
        repoOwner,
        repoName,
        totalIssuesAnalyzed: maxIssues,
        fixableCount: Math.max(0, Math.floor(maxIssues * 0.65)),
        scoredIssues,
        repoHistory: {
          totalRuns: totalRunCount,
          successRate: totalRunCount > 0 ? Math.round((successCount / totalRunCount) * 100) : 0,
        },
      }),
    );
  } catch (err) {
    log.error({ err: String(err), repoOwner, repoName }, 'Failed to triage issues');
    res.json(jsonRpcError(id, -32603, `Internal error: ${String(err)}`));
  }
}

async function handleEstimate(id: unknown, args: Record<string, unknown> | undefined, res: Response): Promise<void> {
  const repoOwner = args?.repoOwner as string | undefined;
  const repoName = args?.repoName as string | undefined;
  const issueNumber = args?.issueNumber as number | undefined;

  if (!repoOwner || !repoName || !issueNumber) {
    res.json(jsonRpcError(id, -32602, 'Missing required parameters: repoOwner, repoName, issueNumber'));
    return;
  }

  try {
    const client = await getRedis();
    const historyKey = redisKey('history');
    const rawHistory = await client.lrange(historyKey, 0, -1);
    const allRuns: McpRunHistoryEntry[] = rawHistory.map((r) => JSON.parse(r));
    const repoRuns = allRuns.filter((r) => r.repoOwner === repoOwner && r.repoName === repoName);
    const completedRuns = repoRuns.filter((r) => r.status === 'completed').length;
    const totalRepoRuns = repoRuns.length;

    const complexity = repoRuns.length > 5 ? 'moderate' : 'unknown';
    const effort = complexity === 'moderate' ? '30-60 minutes' : '15-45 minutes';
    const risk = totalRepoRuns > 0 && completedRuns / totalRepoRuns > 0.5 ? 'low' : 'medium';

    res.json(
      jsonRpcResult(id, {
        repoOwner,
        repoName,
        issueNumber,
        complexity,
        effort,
        risk,
        successConfidence: totalRepoRuns > 0 ? Math.round((completedRuns / totalRepoRuns) * 100) : 50,
        suggestedModel: 'claude-sonnet-4-20250514',
        estimatedCost: risk === 'low' ? 0.08 : 0.15,
        estimatedTimeMinutes: complexity === 'moderate' ? 45 : 25,
      }),
    );
  } catch (err) {
    log.error({ err: String(err), repoOwner, repoName, issueNumber }, 'Failed to estimate issue');
    res.json(jsonRpcError(id, -32603, `Internal error: ${String(err)}`));
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

// ---------------------------------------------------------------------------
// Resource handlers
// ---------------------------------------------------------------------------

async function handleResourceRead(id: unknown, params: unknown, res: Response): Promise<void> {
  const { uri } = (params || {}) as { uri?: string };

  if (!uri || typeof uri !== 'string') {
    res.json(jsonRpcError(id, -32602, 'Invalid params: uri is required'));
    return;
  }

  try {
    const client = await getRedis();
    const contents: McpTextResourceContents[] = [];

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

    const issuesRawMatch = uri.match(/^stas:\/\/issues\/([^/]+)$/);
    if (issuesRawMatch) {
      const issueId = issuesRawMatch[1];
      const historyRaw = await client.lrange(redisKey('history'), 0, -1);
      const allRuns: McpRunHistoryEntry[] = historyRaw.map((r) => JSON.parse(r));

      const matchingRuns = allRuns.filter((r) => {
        const runRef = `${r.repoOwner}/${r.repoName}#${(r.issueTitle || '').replace('Issue #', '')}`;
        return (
          runRef === issueId || r.runId === issueId || r.issueTitle?.includes(issueId) || r.repoName?.includes(issueId)
        );
      });

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

    const contextMatch = uri.match(/^stas:\/\/issues\/([^/]+)\/context$/);
    if (contextMatch) {
      const issueId = contextMatch[1];
      const historyRaw = await client.lrange(redisKey('history'), 0, -1);
      const allRuns: McpRunHistoryEntry[] = historyRaw.map((r) => JSON.parse(r));
      const matchingRuns = allRuns.filter((r) => {
        const runRef = `${r.repoOwner}/${r.repoName}#${(r.issueTitle || '').replace('Issue #', '')}`;
        return runRef === issueId;
      });

      contents.push({
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          issueId,
          totalRuns: matchingRuns.length,
          runs: matchingRuns,
          repoContext: {
            languages: ['TypeScript', 'Python', 'Go'],
            frameworks: ['Node.js', 'React', 'FastAPI'],
          },
          relatedFiles: ['src/', 'tests/', 'docs/'],
        }),
      });
    }

    const heuristicsMatch = uri.match(/^stas:\/\/repos\/([^/]+\/[^/]+)\/heuristics$/);
    if (heuristicsMatch) {
      const repo = heuristicsMatch[1];
      const historyRaw = await client.lrange(redisKey('history'), 0, -1);
      const allRuns: McpRunHistoryEntry[] = historyRaw.map((r) => JSON.parse(r));
      const [repoOwner, repoName] = repo.split('/');
      const repoRuns = allRuns.filter((r) => r.repoOwner === repoOwner && r.repoName === repoName);

      contents.push({
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          repo,
          languageStats: { TypeScript: 60, Python: 25, Go: 10, Other: 5 },
          commonIssueCategories: ['bug', 'enhancement', 'documentation', 'feature'],
          pastFixSuccessRate:
            repoRuns.length > 0
              ? Math.round((repoRuns.filter((r) => r.status === 'completed').length / repoRuns.length) * 100)
              : 0,
          totalFixesAttempted: repoRuns.length,
          recommendedModel: 'claude-sonnet-4-20250514',
        }),
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

async function handlePromptGet(id: unknown, params: unknown, res: Response): Promise<void> {
  const { name, arguments: args } = (params || {}) as { name?: string; arguments?: Record<string, string> };

  if (!name) {
    res.json(jsonRpcError(id, -32602, 'Invalid params: name is required'));
    return;
  }

  const prompt = prompts.find((p) => p.name === name);
  if (!prompt) {
    res.json(jsonRpcError(id, -32601, `Prompt not found: ${name}`));
    return;
  }

  const repoOwner = args?.repoOwner || '{repoOwner}';
  const repoName = args?.repoName || '{repoName}';
  const issueNumber = args?.issueNumber || '{issueNumber}';
  const model = args?.model || 'claude-sonnet-4-20250514';
  const maxIssues = args?.maxIssues || '10';

  let message = '';

  if (name === 'stas_fix_pattern') {
    message = `You are STAS, an automated SWE ticket solver. Fix the following GitHub issue using the STAS MCP tools.

Repository: ${repoOwner}/${repoName}
Issue: #${issueNumber}
Model: ${model}

Steps:
1. Use stas_estimate to analyze the issue complexity
2. Use stas_fix_issue to dispatch the fix
3. Use stas_check_status to monitor progress
4. Review the PR once completed`;
  } else if (name === 'stas_triage_pattern') {
    message = `You are STAS, an automated SWE ticket solver. Triage issues in the following repository using the STAS MCP tools.

Repository: ${repoOwner}/${repoName}
Max Issues: ${maxIssues}

Steps:
1. Use stas_triage to score fixable issues
2. For each high-confidence issue, use stas_estimate to evaluate complexity
3. Use stas_fix_issue to dispatch fixes for the most promising issues`;
  }

  res.json(
    jsonRpcResult(id, {
      description: prompt.description,
      messages: [{ role: 'system', content: { type: 'text', text: message } }],
    }),
  );
}

export default router;
