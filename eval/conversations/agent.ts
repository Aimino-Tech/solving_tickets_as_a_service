// SYNTARO Conversation Agent — the "agent side" of the eval.
// Deterministic conversational core with REAL tool calls:
//   - GitHub REST API (api.github.com) — ticket existence check + creation
//   - SYNTARO MCP REST (POST /mcp/submit_issue, GET /mcp/status/:runId)
// The agent behaves like the target UX: user says "fix these tickets / do this",
// the agent replies "ticket exists (#N)" or "not yet — I'll create it and fix it",
// creates the ticket when missing, and submits the fix through SYNTARO MCP.

import type {
  AgentAction,
  AgentReply,
  FixResult,
  Ticket,
} from './types.js';

export interface AgentConfig {
  repoOwner: string;
  repoName: string;
  /** SYNTARO backend base URL, e.g. http://localhost:3002 */
  syntaroUrl: string;
  /** per-user MCP API key (Bearer) */
  syntaroApiKey: string;
  /** GitHub token (GH_TOKEN) */
  githubToken: string;
  /** injectable fetch for tests */
  fetchImpl?: typeof fetch;
  /** optional delay (ms) between MCP calls to stay under the server rate limit */
  mcpDelayMs?: number;
  /** max retries on 429 rate-limit responses (default 8) */
  maxRateLimitRetries?: number;
}

const GH_API = 'https://api.github.com';
const NORMALIZE_RE = /\s+/g;

function normalize(title: string): string {
  return title.trim().toLowerCase().replace(NORMALIZE_RE, ' ');
}

export class ConversationAgent {
  private readonly cfg: AgentConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly mcpDelayMs: number;
  private readonly maxRateLimitRetries: number;
  private lastMcpCallAt = 0;
  /** conversation memory: normalized title -> ticket (deterministic + eventual-consistency safe) */
  private readonly known: Map<string, Ticket> = new Map();
  private lastRunIds: string[] = [];
  private listed = false;

  constructor(cfg: AgentConfig) {
    this.cfg = cfg;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.mcpDelayMs = cfg.mcpDelayMs ?? 0;
    this.maxRateLimitRetries = cfg.maxRateLimitRetries ?? 8;
  }

  // ---------- low-level GitHub calls ----------

  private async gh(path: string, init?: RequestInit): Promise<unknown> {
    const isListIssues = !init?.method && path.includes('/issues?state=all');
    for (let attempt = 1; attempt <= 4; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`https://api.github.com${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.cfg.githubToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'syntaro-conversation-eval',
            ...(init?.headers ?? {}),
          },
        });
      } catch (fetchErr) {
        // Network-level failures (DNS, TLS, connection reset) are transient:
        // retry with backoff before giving up.
        if (attempt < 4) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw new Error(`GitHub ${init?.method ?? 'GET'} ${path} -> fetch failed: ${String(fetchErr).slice(0, 200)}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`GitHub ${init?.method ?? 'GET'} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      // GitHub's issue list is eventually consistent right after issue creation:
      // an empty response for a repo that should have tickets is transient — retry.
      if (isListIssues && Array.isArray(data) && data.length === 0 && this.known.size > 0) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
        continue;
      }
      return data as unknown;
    }
    return [] as unknown;
  }

  private async listTickets(): Promise<Ticket[]> {
    const raw = (await this.gh(
      `/repos/${this.cfg.repoOwner}/${this.cfg.repoName}/issues?state=all&per_page=100&sort=created&direction=desc`,
    )) as Array<Record<string, unknown>>;
    const tickets: Ticket[] = [];
    for (const it of raw) {
      if (it.pull_request) continue; // issues list includes PRs
      tickets.push({
        number: Number(it.number),
        title: String(it.title ?? ''),
        state: String(it.state ?? 'open') as Ticket['state'],
        url: String(it.html_url ?? ''),
      });
    }
    // Union with conversation memory: tickets created in this conversation are
    // authoritative even while GitHub's list index is still catching up.
    const byNumber = new Map<number, Ticket>();
    for (const t of tickets) byNumber.set(t.number, t);
    for (const t of this.known.values()) if (!byNumber.has(t.number)) byNumber.set(t.number, t);
    for (const t of byNumber.values()) this.known.set(normalize(t.title), t);
    this.listed = true;
    return [...byNumber.values()].sort((a, b) => b.number - a.number);
  }

  /** Find a ticket by exact (normalized) title. Memory first, then repo list. */
  async findTicketByTitle(title: string): Promise<Ticket | null> {
    const key = normalize(title);
    const mem = this.known.get(key);
    if (mem) return mem;
    if (!this.listed) await this.listTickets();
    return this.known.get(key) ?? null;
  }

  async createTicket(title: string, body: string): Promise<Ticket> {
    const raw = (await this.gh(`/repos/${this.cfg.repoOwner}/${this.cfg.repoName}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    })) as Record<string, unknown>;
    const ticket: Ticket = {
      number: Number(raw.number),
      title: String(raw.title ?? title),
      state: 'open',
      url: String(raw.html_url ?? ''),
    };
    this.known.set(normalize(ticket.title), ticket);
    return ticket;
  }

  // ---------- SYNTARO MCP calls ----------

  private async mcp(path: string, init?: RequestInit): Promise<unknown> {
    // space calls out so a burst does not trip the server's per-window rate limit
    const now = Date.now();
    const waitBefore = this.mcpDelayMs - (now - this.lastMcpCallAt);
    if (waitBefore > 0) await new Promise((r) => setTimeout(r, waitBefore));
    this.lastMcpCallAt = Date.now();

    for (let attempt = 1; attempt <= this.maxRateLimitRetries + 1; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.cfg.syntaroUrl}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.cfg.syntaroApiKey}`,
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
          },
        });
      } catch (fetchErr) {
        // Network-level failures (DNS, TLS, connection reset) are transient:
        // retry with backoff before giving up.
        if (attempt <= this.maxRateLimitRetries) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw new Error(`SYNTARO ${init?.method ?? 'GET'} ${path} -> fetch failed: ${String(fetchErr).slice(0, 200)}`);
      }
      if (res.status === 429 && attempt <= this.maxRateLimitRetries) {
        const body = await res.json().catch(() => ({})) as { error?: { retryAfter?: number } };
        const retryAfter = body.error?.retryAfter ?? (Number(res.headers.get('Retry-After')) || 5);
        const backoff = Math.max(1, retryAfter) * 1000;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`SYNTARO ${init?.method ?? 'GET'} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
      }
      return res.json() as Promise<unknown>;
    }
    throw new Error(`SYNTARO ${init?.method ?? 'GET'} ${path}: exhausted rate-limit retries`);
  }

  async submitFix(title: string, body: string): Promise<FixResult> {
    const raw = (await this.mcp('/mcp/submit_issue', {
      method: 'POST',
      body: JSON.stringify({
        repoOwner: this.cfg.repoOwner,
        repoName: this.cfg.repoName,
        issueTitle: title,
        issueBody: body,
        labels: ['syntaro:fix'],
        channel: 'eval-conversation',
      }),
    })) as Record<string, unknown>;
    const result: FixResult = {
      runId: String(raw.runId),
      status: String(raw.status ?? 'accepted'),
      pollUrl: String(raw.pollUrl ?? ''),
    };
    this.lastRunIds.push(result.runId);
    return result;
  }

  async checkStatus(runId?: string): Promise<{ runId: string; status: string; message: string }> {
    const id = runId ?? this.lastRunIds[this.lastRunIds.length - 1];
    if (!id) throw new Error('No run submitted yet in this conversation');
    const raw = (await this.mcp(`/mcp/status/${id}`)) as Record<string, unknown>;
    return {
      runId: String(raw.runId ?? id),
      status: String(raw.status ?? 'unknown'),
      message: String(raw.message ?? ''),
    };
  }

  // ---------- conversational core ----------

  /** Extract every quoted title from the message: "like this". */
  private quotedTitles(message: string): string[] {
    const out: string[] = [];
    for (const m of message.matchAll(/"([^"]+)"/g)) out.push(m[1].trim());
    return out.filter(Boolean);
  }

  private intent(message: string): { action: 'fix' | 'create' | 'check' | 'status' | 'list' } {
    // Intent words live OUTSIDE quoted ticket titles — a ticket named "Fix status bug"
    // must not turn the message into a status request.
    const m = message.toLowerCase().replace(/"([^"]+)"/g, '');
    if (/\b(?:status|progress)\b|\b(?:going|proceeding)\b/i.test(m)) return { action: 'status' };
    if (/^(?:create|open|add|file)\b/i.test(m.trim())) return { action: 'create' };
    if (/(?:is|are)\s+there\s+(?:a|an|the)?\s*tickets?\s*(?:for|about)?/i.test(m)) return { action: 'check' };
    if (/does\s+a\s+ticket.*exist/i.test(m)) return { action: 'check' };
    if (/(?:what tickets|list(?:\s+(?:the|all)?)?\s*tickets|show\s+tickets|how many tickets)/i.test(m)) return { action: 'list' };
    if (/(?:fix|please fix|can you fix|do|handle|work on|take care of|would you fix)/i.test(m)) return { action: 'fix' };
    return { action: 'fix' };
  }

  /** Deterministic per-message handling: check/create/submit/status/list. */
  async handleUserMessage(message: string): Promise<AgentReply> {
    const actions: AgentAction[] = [];
    const flags = { ticketsExisted: [] as number[], ticketsCreated: [] as number[], fixesSubmitted: 0, statusChecked: false, listedCount: 0 };
    const { action } = this.intent(message);
    const tag = `[${this.cfg.repoOwner}/${this.cfg.repoName}]`;

    const checkTicket = async (title: string): Promise<Ticket | null> => {
      const t = await this.findTicketByTitle(title);
      actions.push({ type: 'ticket_checked', ticketNumber: t?.number, ticketTitle: title });
      return t;
    };
    const submitFixFor = async (ticket: Ticket, title: string): Promise<void> => {
      const fix = await this.submitFix(title, `Auto-generated eval ticket: ${title}\n\nReproduce the bug and fix it. Conversation eval.`);
      actions.push({ type: 'fix_submitted', ticketNumber: ticket.number, ticketTitle: title, runId: fix.runId, status: fix.status });
      flags.fixesSubmitted += 1;
    };

    if (action === 'list') {
      const tickets = await this.listTickets();
      flags.listedCount = tickets.length;
      actions.push({ type: 'tickets_listed' });
      const summary = tickets.length === 0
        ? 'No tickets in the repo yet.'
        : tickets.slice(0, 10).map((t) => `#${t.number} "${t.title}"`).join(', ');
      return {
        text: `${tag} Found ${tickets.length} ticket(s). ${summary}`,
        actions,
        flags,
      };
    }

    if (action === 'status') {
      const s = await this.checkStatus();
      flags.statusChecked = true;
      actions.push({ type: 'status_checked', runId: s.runId, status: s.status });
      return {
        text: `${tag} Run ${s.runId} status: ${s.status} — ${s.message}`,
        actions,
        flags,
      };
    }

    const titles = this.quotedTitles(message);

    if (action === 'create') {
      const title = titles[0];
      if (!title) {
        return { text: `${tag} I need a ticket title. Say e.g. create ticket "My bug".`, actions, flags };
      }
      const existing = await checkTicket(title);
      if (existing) {
        flags.ticketsExisted.push(existing.number);
        return { text: `${tag} Ticket already exists: #${existing.number} — "${existing.title}". No need to create it.`, actions, flags };
      }
      const created = await this.createTicket(title, 'Auto-created by conversation eval.');
      flags.ticketsCreated.push(created.number);
      actions.push({ type: 'ticket_created', ticketNumber: created.number, ticketTitle: title });
      return { text: `${tag} Created ticket #${created.number} — "${created.title}".`, actions, flags };
    }

    if (action === 'check') {
      const title = titles[0];
      if (!title) {
        return { text: `${tag} I need a ticket title. Say e.g. is there a ticket for "My bug"?`, actions, flags };
      }
      const existing = await checkTicket(title);
      if (existing) {
        flags.ticketsExisted.push(existing.number);
        return { text: `${tag} Ticket exists: #${existing.number} — "${existing.title}".`, actions, flags };
      }
      return { text: `${tag} No ticket for "${title}" yet. Want me to create one and fix it for you?`, actions, flags };
    }

    // fix (default)
    if (titles.length === 0) {
      return { text: `${tag} I can fix tickets for you. Say e.g. fix "Ticket title" or fix these tickets: "A" and "B".`, actions, flags };
    }
    const createdThisTurn: Ticket[] = [];
    const existedThisTurn: Ticket[] = [];
    for (const title of titles) {
      const existing = await checkTicket(title);
      if (existing) {
        existedThisTurn.push(existing);
        flags.ticketsExisted.push(existing.number);
        await submitFixFor(existing, title);
      } else {
        const created = await this.createTicket(title, `Auto-generated eval ticket: ${title}\n\nReproduce the bug and fix it. Conversation eval.`);
        createdThisTurn.push(created);
        flags.ticketsCreated.push(created.number);
        actions.push({ type: 'ticket_created', ticketNumber: created.number, ticketTitle: title });
        await submitFixFor(created, title);
      }
    }
    let text = `${tag} `;
    if (createdThisTurn.length > 0) {
      text += createdThisTurn.map((t) => `Ticket "${t.title}" doesn't exist yet — I'll create it and fix it for you. Created #${t.number}.`).join(' ');
    }
    if (existedThisTurn.length > 0) {
      text += existedThisTurn.map((t) => `Ticket exists: #${t.number} — "${t.title}".`).join(' ');
    }
    text += ' Fix submitted.';
    return { text, actions, flags };
  }
}
