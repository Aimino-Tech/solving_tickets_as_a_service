// SYNTARO Conversation Eval — 10 scripted conversations × 10 turns each.
// Every turn: a User message (simulated) + expectations on the agent's reply.
// Ticket titles are unique per conversation AND per run (tag), so the eval is
// deterministic and re-runnable: a fresh run never collides with prior runs.
// Ticket existence/creation/fix-submission all hit REAL systems:
//   - GitHub REST API (xdnaimino/syntaro-eval-sandbox, private)
//   - SYNTARO MCP on the local backend (:3002) with a real per-user API key

import type { ConversationScript } from './types.js';

export interface ScenarioOptions {
  repoOwner: string;
  repoName: string;
}

/** Build the run-unique title for a conversation. */
export function title(tag: string, convId: number, name: string): string {
  return `[${tag} c${convId}] ${name}`;
}

export function buildScenarios(tag: string, opts: ScenarioOptions): ConversationScript[] {
  const T = (convId: number, name: string) => title(tag, convId, name);
  const { repoOwner, repoName } = opts;

  return [
    {
      id: 1,
      name: 'first-fix-lifecycle',
      repoOwner,
      repoName,
      turns: [
        { user: `fix the ticket "${T(1, 'Login redirect fails after OAuth')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true, replyIncludes: ["doesn't exist yet", 'Created #', 'Fix submitted'] } },
        { user: `is there a ticket for "${T(1, 'Login redirect fails after OAuth')}"?`, expect: { action: 'check', ticketExisted: true, replyIncludes: ['Ticket exists'] } },
        { user: `fix "${T(1, 'Login redirect fails after OAuth')}" again`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true, replyIncludes: ['Ticket exists', 'Fix submitted'] } },
        { user: 'check the status of the fix', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `create a ticket for "${T(1, 'Add retry to API client')}"`, expect: { action: 'create', ticketCreated: true, replyIncludes: ['Created ticket #'] } },
        { user: `fix "${T(1, 'Add retry to API client')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true, replyIncludes: ['Ticket exists'] } },
        { user: 'what tickets exist?', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `fix "${T(1, 'Webhook signature validation too strict')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true, replyIncludes: ["doesn't exist yet"] } },
        { user: 'check status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `fix "${T(1, 'Webhook signature validation too strict')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
      ],
    },
    {
      id: 2,
      name: 'multi-ticket-batch',
      repoOwner,
      repoName,
      turns: [
        { user: `fix these tickets: "${T(2, 'API rate limiter missing')}" and "${T(2, 'Timeout too short')}"`, expect: { action: 'fix', ticketCreated: true, minFixes: 2, replyIncludes: ['Created #', 'Fix submitted'] } },
        { user: 'check the status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: 'list all tickets', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `is there a ticket for "${T(2, 'API rate limiter missing')}"?`, expect: { action: 'check', ticketExisted: true, replyIncludes: ['Ticket exists'] } },
        { user: `fix "${T(2, 'API rate limiter missing')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: `fix "${T(2, 'Timeout too short')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: `create ticket "${T(2, 'Log structured errors')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: `fix "${T(2, 'Log structured errors')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'check status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: 'what tickets are there?', expect: { action: 'list', replyIncludes: ['Found'] } },
      ],
    },
    {
      id: 3,
      name: 'do-this-do-that',
      repoOwner,
      repoName,
      turns: [
        { user: `fix "${T(3, 'Broken JSON export')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true } },
        { user: `do "${T(3, 'Broken JSON export')}" too`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'how is the fix going?', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `create a ticket "${T(3, 'Validate CSV upload')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: `fix "${T(3, 'Validate CSV upload')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: `fix "${T(3, 'S3 upload fails silently')}" and "${T(3, 'Retry queue stuck')}"`, expect: { action: 'fix', ticketCreated: true, minFixes: 2 } },
        { user: 'status please', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `does a ticket for "${T(3, 'S3 upload fails silently')}" exist?`, expect: { action: 'check', ticketExisted: true, replyIncludes: ['Ticket exists'] } },
        { user: 'list the tickets', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `fix "${T(3, 'S3 upload fails silently')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
      ],
    },
    {
      id: 4,
      name: 'check-then-fix',
      repoOwner,
      repoName,
      turns: [
        { user: `is there a ticket for "${T(4, 'OAuth token refresh race')}"?`, expect: { action: 'check', replyIncludes: ['No ticket'] } },
        { user: `fix "${T(4, 'OAuth token refresh race')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true } },
        { user: 'status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `is there a ticket for "${T(4, 'OAuth token refresh race')}"?`, expect: { action: 'check', ticketExisted: true, replyIncludes: ['Ticket exists'] } },
        { user: `fix "${T(4, 'OAuth token refresh race')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: `create a ticket "${T(4, 'Add metrics endpoint')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: 'check status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: 'list tickets', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `fix "${T(4, 'Add metrics endpoint')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'what is the status?', expect: { action: 'status', replyIncludes: ['status:'] } },
      ],
    },
    {
      id: 5,
      name: 'status-watcher',
      repoOwner,
      repoName,
      turns: [
        { user: `fix "${T(5, 'Empty state crashes dashboard')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true } },
        { user: 'status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: 'check the status again', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `fix "${T(5, 'Empty state crashes dashboard')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `create ticket "${T(5, 'Migrate DB indexes')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: `fix "${T(5, 'Migrate DB indexes')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'check status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: 'what tickets exist?', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `fix "${T(5, 'Empty state crashes dashboard')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
      ],
    },
    {
      id: 6,
      name: 'creator-then-fixer',
      repoOwner,
      repoName,
      turns: [
        { user: `create a ticket "${T(6, 'Cache invalidation bug')}"`, expect: { action: 'create', ticketCreated: true, replyIncludes: ['Created ticket #'] } },
        { user: `is there a ticket for "${T(6, 'Cache invalidation bug')}"?`, expect: { action: 'check', ticketExisted: true, replyIncludes: ['Ticket exists'] } },
        { user: `fix "${T(6, 'Cache invalidation bug')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `create "${T(6, 'Pagination off-by-one')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: `fix "${T(6, 'Pagination off-by-one')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: `create "${T(6, 'Sentry source maps')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: 'check the status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: 'list the tickets', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `fix "${T(6, 'Cache invalidation bug')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
      ],
    },
    {
      id: 7,
      name: 'everything-mixed',
      repoOwner,
      repoName,
      turns: [
        { user: `fix "${T(7, 'Webhook retry storm')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true } },
        { user: 'status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: 'list tickets', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `create a ticket for "${T(7, 'Add request ID header')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: `fix "${T(7, 'Add request ID header')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: `is there a ticket for "${T(7, 'Webhook retry storm')}"?`, expect: { action: 'check', ticketExisted: true, replyIncludes: ['Ticket exists'] } },
        { user: `fix "${T(7, 'Webhook retry storm')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'check status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `fix "${T(7, 'Rate limit 429 handling')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true } },
        { user: 'what tickets exist?', expect: { action: 'list', replyIncludes: ['Found'] } },
      ],
    },
    {
      id: 8,
      name: 'check-loops',
      repoOwner,
      repoName,
      turns: [
        { user: `is there a ticket for "${T(8, 'SSE reconnect loop')}"?`, expect: { action: 'check', replyIncludes: ['No ticket'] } },
        { user: `fix "${T(8, 'SSE reconnect loop')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true } },
        { user: `does a ticket for "${T(8, 'SSE reconnect loop')}" exist?`, expect: { action: 'check', ticketExisted: true, replyIncludes: ['Ticket exists'] } },
        { user: `fix "${T(8, 'SSE reconnect loop')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `create "${T(8, 'Health check endpoint')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: `fix "${T(8, 'Health check endpoint')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'check status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: 'list tickets', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `fix "${T(8, 'SSE reconnect loop')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
      ],
    },
    {
      id: 9,
      name: 'polite-requests',
      repoOwner,
      repoName,
      turns: [
        { user: `can you fix "${T(9, 'Payment webhook signature')}"?`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true } },
        { user: `please fix "${T(9, 'Payment webhook signature')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'check the status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `create a ticket "${T(9, 'Receipt PDF generation')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: `can you fix "${T(9, 'Receipt PDF generation')}"?`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: `do "${T(9, 'Payment webhook signature')}" again`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'list the tickets', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `is there a ticket for "${T(9, 'Receipt PDF generation')}"?`, expect: { action: 'check', ticketExisted: true, replyIncludes: ['Ticket exists'] } },
        { user: `fix "${T(9, 'Email delivery retries')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true } },
        { user: 'status', expect: { action: 'status', replyIncludes: ['status:'] } },
      ],
    },
    {
      id: 10,
      name: 'full-lifecycle-regression',
      repoOwner,
      repoName,
      turns: [
        { user: `fix "${T(10, 'Load balancer sticky sessions')}"`, expect: { action: 'fix', ticketCreated: true, fixSubmitted: true } },
        { user: `is there a ticket for "${T(10, 'Load balancer sticky sessions')}"?`, expect: { action: 'check', ticketExisted: true, replyIncludes: ['Ticket exists'] } },
        { user: 'status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `fix "${T(10, 'Load balancer sticky sessions')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'what tickets exist?', expect: { action: 'list', replyIncludes: ['Found'] } },
        { user: `create a ticket "${T(10, 'Audit log pagination')}"`, expect: { action: 'create', ticketCreated: true } },
        { user: `fix "${T(10, 'Audit log pagination')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'check status', expect: { action: 'status', replyIncludes: ['status:'] } },
        { user: `fix "${T(10, 'Load balancer sticky sessions')}"`, expect: { action: 'fix', ticketExisted: true, fixSubmitted: true } },
        { user: 'what is the status?', expect: { action: 'status', replyIncludes: ['status:'] } },
      ],
    },
  ];
}
