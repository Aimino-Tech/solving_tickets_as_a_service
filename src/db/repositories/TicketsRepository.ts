import { queryWithRetry } from '../connection.js';

export interface Ticket {
  id: number;
  accountId: number;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  title: string;
  body: string | null;
  source: string;
  kind: 'ticket' | 'warning';
  severity: string | null;
  status: 'open' | 'fixing' | 'fixed' | 'failed' | 'closed';
  fixDispatchId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTicket {
  accountId: number;
  repoOwner: string;
  repoName: string;
  issueNumber?: number;
  title: string;
  body?: string | null;
  source?: string;
  kind?: 'ticket' | 'warning';
  severity?: string | null;
  status?: Ticket['status'];
}

const SELECT_COLS = `id, account_id as "accountId", repo_owner as "repoOwner", repo_name as "repoName",
  issue_number as "issueNumber", title, body, source, kind, severity, status,
  fix_dispatch_id as "fixDispatchId", created_at as "createdAt", updated_at as "updatedAt"`;

export class TicketsRepository {
  async create(data: NewTicket): Promise<Ticket> {
    const result = await queryWithRetry<Ticket>(
      `INSERT INTO tickets (account_id, repo_owner, repo_name, issue_number, title, body, source, kind, severity, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${SELECT_COLS}`,
      [
        data.accountId,
        data.repoOwner,
        data.repoName,
        data.issueNumber ?? 0,
        data.title,
        data.body ?? null,
        data.source ?? 'dashboard',
        data.kind ?? 'ticket',
        data.severity ?? null,
        data.status ?? 'open',
      ],
    );
    return result.rows[0];
  }

  async findById(id: number): Promise<Ticket | undefined> {
    const result = await queryWithRetry<Ticket>(
      `SELECT ${SELECT_COLS} FROM tickets WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  }

  async listByAccount(accountId: number, filter: { status?: string; limit?: number; offset?: number } = {}): Promise<Ticket[]> {
    const conditions = ['account_id = $1'];
    const params: unknown[] = [accountId];
    let idx = 2;
    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filter.status);
    }
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const result = await queryWithRetry<Ticket>(
      `SELECT ${SELECT_COLS} FROM tickets WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  async updateStatus(id: number, status: Ticket['status'], fixDispatchId?: string | null): Promise<Ticket | undefined> {
    const result = await queryWithRetry<Ticket>(
      `UPDATE tickets
       SET status = $2, fix_dispatch_id = COALESCE($3, fix_dispatch_id), updated_at = NOW()
       WHERE id = $1
       RETURNING ${SELECT_COLS}`,
      [id, status, fixDispatchId ?? null],
    );
    return result.rows[0];
  }
}

export const ticketsRepository = new TicketsRepository();
