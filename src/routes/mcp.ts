import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { mcpSubmitIssueRequestSchema } from '../opencode-contract.js';
import type { McpSubmitIssueResponse, McpJobStatus, McpRunHistoryEntry } from '../opencode-contract.js';

const log = rootLogger.child({ module: 'mcp-routes' });

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
      log.error({ err: String(err) }, 'MCP Redis error');
    });
    await redis.connect();
  }
  return redis;
}

const JOB_TTL = 7 * 86_400;

function redisKey(...parts: string[]): string {
  return parts.join(':');
}

function mcpAuth(req: Request, res: Response, next: () => void): void {
  if (!config.mcp.authEnabled) { next(); return; }
  const apiKey = config.mcp.apiKey;
  if (!apiKey) { next(); return; }
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token !== apiKey) {
    res.status(401).json({ error: 'Invalid authorization' });
    return;
  }
  next();
}

async function saveJob(client: Redis, runId: string, data: McpJobStatus): Promise<void> {
  await client.setex(redisKey('job', runId), JOB_TTL, JSON.stringify(data));
}

async function getJob(client: Redis, runId: string): Promise<McpJobStatus | null> {
  const raw = await client.get(redisKey('job', runId));
  if (!raw) return null;
  return JSON.parse(raw) as McpJobStatus;
}

async function addToHistory(client: Redis, entry: McpRunHistoryEntry): Promise<void> {
  const historyKey = redisKey('history');
  const raw = await client.lrange(historyKey, 0, -1);
  const history: McpRunHistoryEntry[] = raw.map((r) => JSON.parse(r));
  history.unshift(entry);
  const trimmed = history.slice(0, 100);
  await client.del(historyKey);
  for (const h of trimmed) {
    await client.rpush(historyKey, JSON.stringify(h));
  }
  await client.expire(historyKey, JOB_TTL);
}

async function getHistory(client: Redis, limit: number): Promise<McpRunHistoryEntry[]> {
  const raw = await client.lrange(redisKey('history'), 0, limit - 1);
  return raw.map((r) => JSON.parse(r));
}

const router = Router();

router.use('/mcp', mcpAuth);

router.post('/mcp/submit_issue', async (req: Request, res: Response) => {
  const parseResult = mcpSubmitIssueRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { repoOwner, repoName, issueTitle, issueBody, labels, channel, channelTarget } = parseResult.data;

  try {
    const client = await getRedis();
    const runId = randomUUID();
    const now = new Date().toISOString();

    const jobData: McpJobStatus = {
      runId, status: 'queued', message: 'Issue queued for processing', createdAt: now, updatedAt: now,
    };

    await saveJob(client, runId, jobData);

    const historyEntry: McpRunHistoryEntry = {
      runId, repoOwner, repoName, issueTitle, status: 'queued', createdAt: now,
    };
    await addToHistory(client, historyEntry);

    try {
      const { enqueueIssue } = await import('../queue/issueQueue.js');
      await enqueueIssue(undefined, {
        installationId: 0, repoOwner, repoName, repoPrivate: false, issueNumber: 0,
        issueTitle, issueBody, source: channel || 'mcp', labels: labels || [],
      });
    } catch (queueErr) {
      log.error({ err: String(queueErr), runId }, 'Failed to enqueue MCP issue');
    }

    const pollUrl = `${req.protocol}://${req.get('host')}/mcp/status/${runId}`;
    const response: McpSubmitIssueResponse = { runId, status: 'accepted', pollUrl, createdAt: now };

    log.info({ runId, repoOwner, repoName, issueTitle }, 'MCP issue submitted');
    res.status(201).json(response);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to submit MCP issue');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/mcp/status/:runId', async (req: Request, res: Response) => {
  const { runId } = req.params;
  if (!runId || typeof runId !== 'string') {
    return res.status(400).json({ error: 'Invalid runId' });
  }
  try {
    const client = await getRedis();
    const job = await getJob(client, runId);
    if (!job) return res.status(404).json({ error: 'Run not found' });
    res.json(job);
  } catch (err) {
    log.error({ err: String(err), runId }, 'Failed to get job status');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/mcp/history', async (req: Request, res: Response) => {
  try {
    const client = await getRedis();
    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 100);
    const history = await getHistory(client, limit);
    res.json({ runs: history, total: history.length });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get run history');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/mcp/repos', (_req: Request, res: Response) => {
  try {
    const repos = config.trackers.defaultRepoOwner && config.trackers.defaultRepoName
      ? [{ owner: config.trackers.defaultRepoOwner, name: config.trackers.defaultRepoName, private: false }]
      : [];
    res.json({ repos });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list repos');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// MCP Bridge: list_issues proxy
router.get('/mcp/issues', async (req: Request, res: Response) => {
  try {
    const mcpUrl = process.env.STAS_MCP_SERVER_URL || 'http://localhost:4095';
    const resp = await fetch(`${mcpUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: randomUUID(), method: 'tools/call',
        params: { name: 'list_issues', arguments: { status: req.query.status, repo: req.query.repo, limit: Math.min(Math.abs(Number(req.query.limit) || 20), 100) } },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const text = data?.result?.content?.[0]?.text;
      if (text) { try { return res.json(JSON.parse(text)); } catch { return res.json({ result: text }); } }
      return res.json(data.result);
    }
  } catch { log.debug('MCP server not reachable for list_issues'); }
  res.json({ error: 'MCP server not reachable' });
});

// MCP Bridge: search_codebase proxy
router.post('/mcp/search', async (req: Request, res: Response) => {
  try {
    const mcpUrl = process.env.STAS_MCP_SERVER_URL || 'http://localhost:4095';
    const resp = await fetch(`${mcpUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: randomUUID(), method: 'tools/call',
        params: { name: 'search_codebase', arguments: { query: req.body.query, repo: req.body.repo, max_results: Math.min(Math.abs(Number(req.body.max_results) || 10), 50) } },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const text = data?.result?.content?.[0]?.text;
      if (text) { try { return res.json(JSON.parse(text)); } catch { return res.json({ result: text }); } }
      return res.json(data.result);
    }
  } catch { log.debug('MCP server not reachable for search'); }
  res.json({ error: 'MCP server not reachable' });
});

export default router;
