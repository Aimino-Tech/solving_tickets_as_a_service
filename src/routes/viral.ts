/**
 * Agent-to-agent discovery endpoint — MCP manifest for SYNTARO.
 *
 * Serves the MCP discovery manifest at a standardised path so that
 * other agents (Claude Desktop, Cursor, etc.) can discover
 * SYNTARO's capabilities and connect programmatically.
 *
 * Endpoints:
 *   GET /discovery/mcp.json  — MCP server manifest (JSON)
 *   GET /discovery           — Human-readable discovery landing page (HTML)
 *
 * Resource URIs:
 *   syntaro://runs/{run_id}     — Real-time status + PR link for a fix run
 *   syntaro://issues/{issue_id} — Issue details with fix status and run history
 *
 * @module routes/viral
 */

import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'viral-discovery' });

const router: Router = Router();

interface McpDiscoveryManifest {
  schemaVersion: '2024-11-05';
  server: {
    name: string;
    version: string;
    description: string;
    homepage: string;
    documentation: string;
  };
  transports: Array<{
    type: 'sse' | 'streamable-http' | 'stdio';
    url?: string;
    command?: string;
    args?: string[];
    description: string;
  }>;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  resources: Array<{
    uri: string;
    name: string;
    description: string;
    mimeType: string;
  }>;
  install: Record<string, unknown>;
}

export function buildDiscoveryManifest(baseUrl: string): McpDiscoveryManifest {
  return {
    schemaVersion: '2024-11-05',
    server: {
      name: 'syntaro-agent-discovery',
      version: '1.0.0',
      description:
        'SYNTARO — label a GitHub issue and get a pull request. Open-source AI bot for automated bug fixing.',
      homepage: 'https://github.com/tamnguyen08/solving_tickets_as_a_service',
      documentation: 'https://github.com/tamnguyen08/solving_tickets_as_a_service/blob/main/docs/ARCHITECTURE.md',
    },
    transports: [
      {
        type: 'sse',
        url: `${baseUrl}/sse`,
        description: 'Server-Sent Events transport for real-time MCP communication',
      },
      {
        type: 'streamable-http',
        url: `${baseUrl}/mcp`,
        description: 'Streamable HTTP transport (MCP POST endpoint) — send JSON-RPC messages over HTTP',
      },
      {
        type: 'stdio',
        command: 'python',
        args: ['-m', 'syntaro_mcp.server', 'stdio'],
        description: 'Stdio transport for tools like Claude Desktop, Cursor, and other MCP clients',
      },
    ],
    tools: [
      {
        name: 'syntaro_label_issue',
        description: 'Label a GitHub issue with the SYNTARO fix label (or custom label). Triggers the fix pipeline.',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner (user or org)' },
            repo: { type: 'string', description: 'Repository name' },
            issue_number: { type: 'integer', description: 'Issue number' },
            label: { type: 'string', description: 'Label to apply (default: syntaro:fix)' },
          },
          required: ['owner', 'repo', 'issue_number'],
        },
      },
      {
        name: 'syntaro_run_fix',
        description:
          'Trigger the SYNTARO fix pipeline for a GitHub issue URL. Returns a run_id for polling.',
        inputSchema: {
          type: 'object',
          properties: {
            issue_url: { type: 'string', description: 'Full GitHub issue URL (https://github.com/owner/repo/issues/N)' },
          },
          required: ['issue_url'],
        },
      },
      {
        name: 'syntaro_check_status',
        description: 'Check the current status of a SYNTARO fix run by run_id.',
        inputSchema: {
          type: 'object',
          properties: {
            run_id: { type: 'string', description: 'Run ID from syntaro_run_fix (e.g. syntaro-abc123)' },
          },
          required: ['run_id'],
        },
      },
      {
        name: 'syntaro_get_pr',
        description: 'Get the pull request URL and details for a completed SYNTARO fix run.',
        inputSchema: {
          type: 'object',
          properties: {
            run_id: { type: 'string', description: 'Run ID from syntaro_run_fix' },
          },
          required: ['run_id'],
        },
      },
      {
        name: 'list_issues',
        description: 'List tracked issues with their SYNTARO fix status, with optional filters by status or repo.',
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
        description: 'Search the SYNTARO codebase for symbols, files, or patterns across tracked fix runs.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (matched against run IDs, issue URLs, repos, statuses)' },
            repo: { type: 'string', description: 'Optional repo filter (format: owner/repo)' },
            max_results: { type: 'integer', description: 'Max results (default: 10, max: 50)' },
          },
          required: ['query'],
        },
      },
    ],
    resources: [
      {
        uri: 'syntaro://runs/{run_id}',
        name: 'Fix Run Status',
        description: 'Real-time status and PR link for a SYNTARO fix run. Replace {run_id} with the actual run ID.',
        mimeType: 'application/json',
      },
      {
        uri: 'syntaro://issues/{issue_id}',
        name: 'Issue Fix Status',
        description: 'Issue details including current fix status, run history, and linked PRs. The issue_id can be a GitHub issue URL or an issue number.',
        mimeType: 'application/json',
      },
      {
        uri: 'syntaro://status',
        name: 'Server Health',
        description: 'SYNTARO server health and capability overview.',
        mimeType: 'application/json',
      },
      {
        uri: 'syntaro://queue',
        name: 'Fix Queue',
        description: 'Current fix queue depth and status.',
        mimeType: 'application/json',
      },
    ],
    install: {
      opencode: {
        config: {
          name: 'syntaro-agent-discovery',
          transport: 'stdio',
          command: 'python',
          args: ['-m', 'syntaro_mcp.server', 'stdio'],
        },
      },
      claudeDesktop: {
        config: {
          mcpServers: {
            syntaro: {
              command: 'python',
              args: ['-m', 'syntaro_mcp.server', 'stdio'],
            },
          },
        },
      },
      cursor: {
        config: {
          name: 'syntaro-agent-discovery',
          type: 'mcp',
          command: 'python',
          args: ['-m', 'syntaro_mcp.server', 'stdio'],
        },
      },
    },
  };
}

router.get('/discovery/mcp.json', (req: Request, res: Response) => {
  const baseUrl = process.env.SYNTARO_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const manifest = buildDiscoveryManifest(baseUrl);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(manifest);
});

export function renderDiscoveryPage(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SYNTARO — Agent Discovery</title>
  <meta name="description" content="SYNTARO MCP agent discovery endpoint — connect your agent to automated bug fixing." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; line-height: 1.6; }
    .container { max-width: 720px; margin: 0 auto; padding: 3rem 1.5rem; }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
    h1 span { color: #58a6ff; }
    .subtitle { font-size: 1.1rem; color: #8b949e; margin-bottom: 2rem; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
    .card h2 { font-size: 1.1rem; margin-bottom: 0.75rem; color: #f0f6fc; }
    .card p, .card li { font-size: 0.9rem; color: #8b949e; }
    .card ul { list-style: none; padding: 0; }
    .card li { padding: 0.35rem 0; }
    .card li::before { content: "\\25B8 "; color: #58a6ff; }
    code { background: #0d1117; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.85rem; color: #f0f6fc; }
    .endpoint { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85rem; }
    .method { display: inline-block; padding: 0.15rem 0.45rem; border-radius: 4px; font-weight: 600; font-size: 0.75rem; }
    .method.get { background: #1f6feb33; color: #58a6ff; }
    .badge-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1rem 0; }
    .badge-link { display: inline-block; }
    hr { border: none; border-top: 1px solid #30363d; margin: 1.5rem 0; }
    .footer { text-align: center; font-size: 0.8rem; color: #484f58; }
    .footer a { color: #58a6ff; text-decoration: none; }
    .btn { display: inline-block; padding: 0.6rem 1.25rem; border-radius: 6px; font-size: 0.9rem; font-weight: 600; text-decoration: none; background: #238636; color: #fff; margin-top: 0.5rem; }
    .btn:hover { background: #2ea043; }
    .transport-table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    .transport-table th, .transport-table td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #30363d; font-size: 0.85rem; }
    .transport-table th { color: #8b949e; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <h1><span>SYNTARO</span> Agent Discovery</h1>
    <p class="subtitle">SYNTARO — automated bug fixing for your GitHub issues.</p>

    <div class="badge-row">
      <a href="https://img.shields.io/badge/SYNTARO-MCP-8250DF" class="badge-link"><img src="https://img.shields.io/badge/SYNTARO-MCP-8250DF" alt="SYNTARO MCP" /></a>
      <a href="${baseUrl}/discovery/mcp.json" class="badge-link"><img src="https://img.shields.io/badge/Agent-Discovery-0969da" alt="Agent Discovery" /></a>
    </div>

    <div class="card">
      <h2>MCP Discovery Manifest</h2>
      <p>The <code>/discovery/mcp.json</code> endpoint lets any MCP-compatible agent discover SYNTARO's capabilities.</p>
      <div class="endpoint"><span class="method get">GET</span> <code>${baseUrl}/discovery/mcp.json</code></div>
      <p style="margin-top:0.75rem">Connect via <code>syntaro://discovery/mcp.json</code> from any MCP client.</p>
      <a href="${baseUrl}/discovery/mcp.json" class="btn">View Manifest</a>
    </div>

    <div class="card">
      <h2>Available Tools</h2>
      <ul>
        <li><code>syntaro_label_issue</code> — Label a GitHub issue to trigger the fix pipeline</li>
        <li><code>syntaro_run_fix</code> — Submit a GitHub issue URL for automated fixing</li>
        <li><code>syntaro_check_status</code> — Poll fix run status by run_id</li>
        <li><code>syntaro_get_pr</code> — Retrieve PR details for a completed fix</li>
        <li><code>list_issues</code> — List tracked issues with optional status/repo filters</li>
        <li><code>search_codebase</code> — Search across tracked fix runs and issues</li>
      </ul>
    </div>

    <div class="card">
      <h2>MCP Resources</h2>
      <ul>
        <li><code>syntaro://runs/{run_id}</code> — Fix run status and PR link</li>
        <li><code>syntaro://issues/{issue_id}</code> — Issue details with fix status and run history</li>
        <li><code>syntaro://status</code> — Server health and capability overview</li>
        <li><code>syntaro://queue</code> — Current fix queue depth</li>
      </ul>
    </div>

    <div class="card">
      <h2>Transport Protocols</h2>
      <table class="transport-table">
        <tr><th>Transport</th><th>Description</th><th>Use Case</th></tr>
        <tr><td><strong>stdio</strong></td><td>Python subprocess, JSON-RPC over stdin/stdout</td><td>Claude Desktop, Cursor, MCP clients</td></tr>
        <tr><td><strong>SSE</strong></td><td>Server-Sent Events, HTTP streaming</td><td>Remote servers, real-time updates</td></tr>
        <tr><td><strong>Streamable HTTP</strong></td><td>HTTP POST with JSON-RPC, request/response</td><td>Web browsers, REST API clients</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>Installation</h2>
      <p><strong>MCP Client</strong> — Add to your MCP client config:</p>
      <pre style="background:#0d1117;padding:0.75rem;border-radius:6px;margin-top:0.5rem;font-size:0.8rem;overflow-x:auto"><code>{
  "name": "syntaro-agent-discovery",
  "transport": "stdio",
  "command": "python",
  "args": ["-m", "syntaro_mcp.server", "stdio"]
}</code></pre>
      <p style="margin-top:1rem"><strong>Claude Desktop</strong> — Add to <code>claude_desktop_config.json</code>:</p>
      <pre style="background:#0d1117;padding:0.75rem;border-radius:6px;margin-top:0.5rem;font-size:0.8rem;overflow-x:auto"><code>{
  "mcpServers": {
    "syntaro": {
      "command": "python",
      "args": ["-m", "syntaro_mcp.server", "stdio"]
    }
  }
}</code></pre>
      <p style="margin-top:1rem"><strong>Cursor</strong> — Add to Cursor MCP config:</p>
      <pre style="background:#0d1117;padding:0.75rem;border-radius:6px;margin-top:0.5rem;font-size:0.8rem;overflow-x:auto"><code>{
  "name": "syntaro-agent-discovery",
  "type": "mcp",
  "command": "python",
  "args": ["-m", "syntaro_mcp.server", "stdio"]
}</code></pre>
    </div>

    <hr />
    <div class="footer">
      <p><a href="https://github.com/tamnguyen08/solving_tickets_as_a_service">SYNTARO</a> — SYNTARO &mdash; MIT License</p>
    </div>
  </div>
</body>
</html>`;
}

router.get('/discovery', (_req: Request, res: Response) => {
  const baseUrl = process.env.SYNTARO_PUBLIC_URL || 'http://localhost:3000';
  const html = renderDiscoveryPage(baseUrl);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export { router as viralRouter };
