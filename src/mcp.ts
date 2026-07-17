/**
 * MCP endpoint route -- agent discovery and protocol endpoints for the
 * STAS Model Context Protocol server.
 *
 * Mounted at /mcp in the Express app and provides:
 *   GET  /mcp/discovery    -- MCP server capabilities + tool/resource listing
 *   POST /mcp/label        -- Label a GitHub issue (REST shortcut)
 *   POST /mcp/run          -- Trigger a fix run (REST shortcut)
 *   GET  /mcp/runs/:runId  -- Run status (matches stas://runs/{run_id} resource)
 *   GET  /mcp/issues       -- List issues (bridge to list_issues tool)
 *   POST /mcp/search       -- Search codebase (bridge to search_codebase tool)
 *   GET  /mcp/issues/:id   -- Issue resource (matches stas://issues/{issue_id} resource)
 *
 * The full MCP protocol (tools/call, resources/read) is handled by the
 * standalone FastMCP Python server (stas_mcp/server.py) in SSE or stdio mode.
 * This router provides REST-compatible shortcuts + agent discovery metadata.
 */

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from './config.js';
import { rootLogger } from './utils/logger.js';

const log = rootLogger.child({ module: 'mcp-discovery' });

const router: Router = Router();

// ---------------------------------------------------------------------------
// MCP agent discovery endpoint
// ---------------------------------------------------------------------------

router.get('/mcp/discovery', (_req: Request, res: Response) => {
  const mcpServerUrl = config.mcp.serverUrl || `http://localhost:${config.mcp.port}`;
  const protocol = config.mcp.ssl.enabled ? 'https' : 'http';

  res.json({
    server: {
      name: 'stas-agent-discovery',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      description: 'STAS (Solving Tickets As A Service) -- label a GitHub issue and get a PR.',
    },
    transports: [
      {
        type: 'sse',
        url: `${mcpServerUrl}/sse`,
        description: 'Server-Sent Events transport for real-time MCP communication',
      },
      {
        type: 'streamable-http',
        url: `${mcpServerUrl}/mcp`,
        description: 'Streamable HTTP transport (MCP POST endpoint)',
      },
      {
        type: 'stdio',
        command: 'python',
        args: ['-m', 'stas_mcp.server', 'stdio'],
        description: 'Stdio transport for tools like OpenCode and Claude Desktop',
      },
    ],
    tools: [
      {
        name: 'stas_label_issue',
        description: 'Label a GitHub issue with the STAS fix label (or custom label).',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner (user or org)' },
            repo: { type: 'string', description: 'Repository name' },
            issue_number: { type: 'integer', description: 'Issue number' },
            label: { type: 'string', description: 'Label to apply (default: stas:fix)' },
          },
          required: ['owner', 'repo', 'issue_number'],
        },
      },
      {
        name: 'stas_run_fix',
        description: 'Trigger the STAS fix pipeline for a GitHub issue URL. Returns a run_id for polling.',
        inputSchema: {
          type: 'object',
          properties: {
            issue_url: { type: 'string', description: 'Full GitHub issue URL' },
          },
          required: ['issue_url'],
        },
      },
      {
        name: 'stas_check_status',
        description: 'Check the current status of a STAS fix run by run_id.',
        inputSchema: {
          type: 'object',
          properties: {
            run_id: { type: 'string', description: 'Run ID from stas_run_fix' },
          },
          required: ['run_id'],
        },
      },
      {
        name: 'stas_get_pr',
        description: 'Get the pull request URL and details for a completed STAS fix run.',
        inputSchema: {
          type: 'object',
          properties: {
            run_id: { type: 'string', description: 'Run ID from stas_run_fix' },
          },
          required: ['run_id'],
        },
      },
      {
        name: 'list_issues',
        description: 'List tracked issues with their STAS fix status, with optional filters.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Filter by status (queued, running, completed, failed)' },
            repo: { type: 'string', description: 'Filter by repo (format: owner/repo)' },
            limit: { type: 'integer', description: 'Max results (default: 20, max: 100)' },
          },
        },
      },
      {
        name: 'search_codebase',
        description: 'Search the STAS codebase for symbols, files, or patterns.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            repo: { type: 'string', description: 'Optional repo filter' },
            max_results: { type: 'integer', description: 'Max results (default: 10, max: 50)' },
          },
          required: ['query'],
        },
      },
    ],
    resources: [
      {
        uri: 'stas://runs/{run_id}',
        name: 'Fix Run Status',
        description: 'Real-time status and PR link for a STAS fix run.',
        mimeType: 'application/json',
      },
      {
        uri: 'stas://issues/{issue_id}',
        name: 'Issue Fix Status',
        description: 'Issue details including current fix status, run history, and linked PRs.',
        mimeType: 'application/json',
      },
    ],
    install: {
      opencode: {
        config: {
          name: 'stas-agent-discovery',
          transport: 'stdio',
          command: 'python',
          args: ['-m', 'mcp.stas_mcp', 'stdio'],
        },
      },
      claudeDesktop: {
        config: {
          mcpServers: {
            stas: {
              command: 'python',
              args: ['-m', 'mcp.stas_mcp', 'stdio'],
            },
          },
        },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// REST shortcut: label a GitHub issue
// ---------------------------------------------------------------------------

router.post('/mcp/label', async (req: Request, res: Response) => {
  const { owner, repo, issue_number, label } = req.body || {};

  if (!owner || !repo || !issue_number) {
    return res.status(400).json({ error: 'owner, repo, and issue_number are required' });
  }

  try {
    log.info({ owner, repo, issue_number, label }, 'Label issue via MCP shortcut');
    const result = await forwardToMCP('stas_label_issue', {
      owner,
      repo,
      issue_number,
      label: label || config.stas.label,
    });
    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to label issue');
    res.status(500).json({ error: 'Failed to label issue', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// REST shortcut: trigger a fix run
// ---------------------------------------------------------------------------

router.post('/mcp/run', async (req: Request, res: Response) => {
  const { issue_url } = req.body || {};

  if (!issue_url) {
    return res.status(400).json({ error: 'issue_url is required' });
  }

  try {
    log.info({ issue_url }, 'Trigger fix run via MCP shortcut');
    const result = await forwardToMCP('stas_run_fix', { issue_url });
    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to trigger fix run');
    res.status(500).json({ error: 'Failed to trigger fix run', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// REST shortcut: get run status (matches stas://runs/{run_id} resource)
// ---------------------------------------------------------------------------

router.get('/mcp/runs/:runId', async (req: Request, res: Response) => {
  const { runId } = req.params;

  try {
    log.info({ runId }, 'Get run status via MCP shortcut');
    const result = await forwardToMCP('stas_check_status', { run_id: runId });
    res.json(result);
  } catch (err) {
    log.error({ err: String(err), runId }, 'Failed to get run status');
    res.status(500).json({ error: 'Failed to get run status', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Helper: forward a tool call to the Python FastMCP server
// ---------------------------------------------------------------------------

async function forwardToMCP(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const mcpServerUrl = config.mcp.serverUrl || `http://localhost:${config.mcp.port}`;

  try {
    const response = await fetch(`${mcpServerUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        const textContent = data.result.content?.[0]?.text;
        if (textContent) {
          try {
            return JSON.parse(textContent);
          } catch {
            return { result: textContent };
          }
        }
        return data.result;
      }
      if (data.error) {
        throw new Error(data.error.message || 'MCP tool call failed');
      }
      return data;
    }
    throw new Error(`MCP server responded with ${response.status}`);
  } catch (err) {
    log.warn({ toolName, err: String(err) }, 'MCP server not reachable, returning offline response');
    return {
      success: false,
      error: `MCP server not reachable at ${mcpServerUrl}`,
      offline: true,
      toolName,
      args,
    };
  }
}

export default router;
