// Unit tests for ConversationAgent — deterministic with a mocked fetch.
// Proves the conversational core logic (check/create/submit/status/list,
// multi-ticket batching, missing-vs-existing replies) without network.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationAgent } from '../agent.js';

interface FakeIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  pull_request?: unknown;
}

interface FakeJob {
  runId: string;
  status: string;
  message: string;
}

class FakeFetch {
  issues: FakeIssue[] = [];
  jobs: FakeJob[] = [];
  nextNumber = 1;
  submitCount = 0;
  statusCount = 0;
  listCount = 0;
  calls: Array<{ url: string; method: string; body?: string }> = [];

  private ok(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  handler = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? String(init.body) : undefined;
    this.calls.push({ url, method, body });

    if (url.startsWith('https://api.github.com/repos/') && url.includes('/issues') && method === 'GET') {
      this.listCount += 1;
      return Promise.resolve(this.ok(this.issues));
    }
    if (url.startsWith('https://api.github.com/repos/') && url.endsWith('/issues') && method === 'POST') {
      const parsed = JSON.parse(body ?? '{}') as { title?: string };
      const issue: FakeIssue = {
        number: this.nextNumber++,
        title: parsed.title ?? 'untitled',
        state: 'open',
        html_url: `https://github.com/xdnaimino/stas-eval-sandbox/issues/${this.nextNumber - 1}`,
      };
      this.issues.push(issue);
      return Promise.resolve(this.ok(issue, 201));
    }
    if (url.endsWith('/mcp/submit_issue') && method === 'POST') {
      this.submitCount += 1;
      const job: FakeJob = { runId: `run-${this.submitCount}`, status: 'accepted', message: 'Issue queued for processing' };
      this.jobs.push(job);
      return Promise.resolve(this.ok({ runId: job.runId, status: job.status, pollUrl: `http://localhost:3002/mcp/status/${job.runId}` }, 201));
    }
    if (url.includes('/mcp/status/') && method === 'GET') {
      this.statusCount += 1;
      const runId = url.split('/mcp/status/')[1];
      const job = this.jobs.find((j) => j.runId === runId);
      if (!job) return Promise.resolve(this.ok({ error: 'Run not found' }, 404));
      return Promise.resolve(this.ok({ runId: job.runId, status: job.status, message: job.message }));
    }
    return Promise.resolve(this.ok({ error: `unhandled ${method} ${url}` }, 500));
  };
}

const cfg = {
  repoOwner: 'xdnaimino',
  repoName: 'stas-eval-sandbox',
  stasUrl: 'http://localhost:3002',
  stasApiKey: 'sk-stas_test',
  githubToken: 'gho_test',
};

function makeAgent(fake: FakeFetch): ConversationAgent {
  return new ConversationAgent({ ...cfg, fetchImpl: fake.handler as unknown as typeof fetch });
}

describe('ConversationAgent', () => {
  let fake: FakeFetch;
  let agent: ConversationAgent;

  beforeEach(() => {
    fake = new FakeFetch();
    agent = makeAgent(fake);
  });

  it('creates + submits fix for a missing ticket, replying "doesn\'t exist yet"', async () => {
    const reply = await agent.handleUserMessage('fix the ticket "Login redirect fails"');
    expect(reply.flags.ticketsCreated).toHaveLength(1);
    expect(reply.flags.fixesSubmitted).toBe(1);
    expect(reply.text).toContain("doesn't exist yet");
    expect(reply.text).toContain('Created #1');
    expect(reply.text).toContain('Fix submitted');
    expect(fake.issues).toHaveLength(1);
    expect(fake.submitCount).toBe(1);
    const created = fake.issues[0];
    expect(created.title).toBe('Login redirect fails');
    const submitCall = fake.calls.find((c) => c.url.endsWith('/mcp/submit_issue'));
    expect(submitCall?.body).toContain('Login redirect fails');
  });

  it('reports existing ticket + still submits fix when ticket already exists', async () => {
    fake.issues = [{ number: 42, title: 'Known bug', state: 'open', html_url: 'https://x/42' }];
    const reply = await agent.handleUserMessage('fix "Known bug"');
    expect(reply.flags.ticketsExisted).toEqual([42]);
    expect(reply.flags.ticketsCreated).toHaveLength(0);
    expect(reply.flags.fixesSubmitted).toBe(1);
    expect(reply.text).toContain('Ticket exists: #42');
    expect(fake.issues).toHaveLength(1); // no new ticket created
    expect(fake.submitCount).toBe(1);
  });

  it('multi-ticket: "fix these tickets: A and B" creates both and submits 2 fixes', async () => {
    const reply = await agent.handleUserMessage('fix these tickets: "Alpha bug" and "Beta bug"');
    expect(reply.flags.ticketsCreated).toHaveLength(2);
    expect(reply.flags.fixesSubmitted).toBe(2);
    expect(fake.issues).toHaveLength(2);
    expect(fake.submitCount).toBe(2);
  });

  it('check: reports existing ticket', async () => {
    fake.issues = [{ number: 7, title: 'Check bug', state: 'open', html_url: 'https://x/7' }];
    const reply = await agent.handleUserMessage('is there a ticket for "Check bug"?');
    expect(reply.flags.ticketsExisted).toEqual([7]);
    expect(reply.flags.fixesSubmitted).toBe(0);
    expect(reply.text).toContain('Ticket exists: #7');
  });

  it('check: reports no ticket when missing', async () => {
    const reply = await agent.handleUserMessage('is there a ticket for "Ghost bug"?');
    expect(reply.flags.ticketsExisted).toHaveLength(0);
    expect(reply.text).toContain('No ticket');
  });

  it('create: creates only, never submits a fix', async () => {
    const reply = await agent.handleUserMessage('create a ticket "New feature ticket"');
    expect(reply.flags.ticketsCreated).toHaveLength(1);
    expect(reply.flags.fixesSubmitted).toBe(0);
    expect(reply.text).toContain('Created ticket #1');
    expect(fake.submitCount).toBe(0);
  });

  it('status: checks the last submitted run', async () => {
    await agent.handleUserMessage('fix "Status bug"');
    const reply = await agent.handleUserMessage('check the status');
    expect(reply.flags.statusChecked).toBe(true);
    expect(reply.text).toContain('status:');
    expect(reply.text).toContain('Run run-1');
    expect(fake.statusCount).toBe(1);
  });

  it('list: lists repo tickets', async () => {
    fake.issues = [
      { number: 1, title: 'A', state: 'open', html_url: 'https://x/1' },
      { number: 2, title: 'B', state: 'closed', html_url: 'https://x/2' },
    ];
    const reply = await agent.handleUserMessage('what tickets exist?');
    expect(reply.flags.listedCount).toBe(2);
    expect(reply.text).toContain('Found 2 ticket(s)');
  });

  it('memory: a ticket created earlier is found later without another create', async () => {
    await agent.handleUserMessage('fix "Remember me bug"');
    fake.submitCount = 0; // reset so we can assert only 1 new submit
    const reply = await agent.handleUserMessage('fix "Remember me bug" again');
    expect(reply.flags.ticketsExisted).toHaveLength(1);
    expect(reply.flags.ticketsCreated).toHaveLength(0);
    expect(reply.flags.fixesSubmitted).toBe(1);
  });

  it('guidance: fix intent with no quoted title returns help text', async () => {
    const reply = await agent.handleUserMessage('fix');
    expect(reply.flags.fixesSubmitted).toBe(0);
    expect(reply.text).toContain('I can fix tickets for you');
  });

  it('bare "status" word triggers a status check (no prefix needed)', async () => {
    await agent.handleUserMessage('fix "Status word bug"');
    fake.submitCount = 0;
    const reply = await agent.handleUserMessage('status');
    expect(reply.flags.statusChecked).toBe(true);
    expect(reply.text).toContain('status:');
  });

  it('"how is the fix going?" triggers a status check', async () => {
    await agent.handleUserMessage('fix "Going bug"');
    const reply = await agent.handleUserMessage('how is the fix going?');
    expect(reply.flags.statusChecked).toBe(true);
    expect(reply.flags.fixesSubmitted).toBe(0);
  });

  it('create without the word "ticket" ("create \"X\"") still creates only', async () => {
    const reply = await agent.handleUserMessage('create "Bare create bug"');
    expect(reply.flags.ticketsCreated).toHaveLength(1);
    expect(reply.flags.fixesSubmitted).toBe(0);
    expect(fake.issues).toHaveLength(1);
    expect(reply.text).toContain('Created ticket #1');
  });

  it('list shows tickets created earlier in the conversation even if API lags', async () => {
    // API returns [] (simulated eventual consistency) but memory has created tickets
    await agent.handleUserMessage('fix "Memory list bug"');
    fake.issues = []; // simulate stale/empty API index
    const reply = await agent.handleUserMessage('what tickets exist?');
    expect(reply.flags.listedCount).toBeGreaterThanOrEqual(1);
    expect(reply.text).toContain('Found');
  });

  it('fix intent with no quoted title returns guidance text', async () => {
    const reply = await agent.handleUserMessage('fix');
    expect(reply.flags.fixesSubmitted).toBe(0);
    expect(reply.text).toContain('I can fix tickets for you');
  });

  it('retries on 429 rate limit using retryAfter, then succeeds', async () => {
    const flaky = new FakeFetch();
    let mcpCalls = 0;
    const origHandler = flaky.handler.bind(flaky);
    flaky.handler = (input, init) => {
      const url = String(input);
      if (url.endsWith('/mcp/submit_issue')) {
        mcpCalls += 1;
        if (mcpCalls === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', retryAfter: 0 } }), { status: 429 }));
        }
      }
      return origHandler(input as string, init);
    };
    const a = new ConversationAgent({ ...cfg, fetchImpl: flaky.handler as unknown as typeof fetch, mcpDelayMs: 0 });
    const reply = await a.handleUserMessage('fix "Rate limited bug"');
    expect(mcpCalls).toBe(2);
    expect(reply.flags.fixesSubmitted).toBe(1);
    expect(reply.flags.ticketsCreated).toHaveLength(1);
  });

  it('surfaces STAS 401 as a throw (bad key)', async () => {
    const bad = new FakeFetch();
    const origHandler = bad.handler.bind(bad);
    bad.handler = (input, init) => {
      const url = String(input);
      if (url.endsWith('/mcp/submit_issue')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'Invalid or missing API key' }), { status: 401 }));
      }
      return origHandler(input as string, init);
    };
    const a = makeAgent(bad);
    await expect(a.handleUserMessage('fix "Auth bug"')).rejects.toThrow(/401/);
  });
});
