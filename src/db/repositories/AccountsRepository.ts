import { queryWithRetry, validateSqlIdentifier } from '../connection.js';
import type { Account, NewAccount } from '../types/index.js';

export class AccountsRepository {
  async findByEmail(email: string): Promise<Account | undefined> {
    const result = await queryWithRetry<Account>('SELECT * FROM accounts WHERE email = $1', [email]);
    return result.rows[0];
  }

  async findByInstallationId(githubInstallationId: number): Promise<Account | undefined> {
    const result = await queryWithRetry<Account>('SELECT * FROM accounts WHERE github_installation_id = $1', [
      githubInstallationId,
    ]);
    return result.rows[0];
  }

  async findById(id: number): Promise<Account | undefined> {
    const result = await queryWithRetry<Account>('SELECT * FROM accounts WHERE id = $1', [id]);
    return result.rows[0];
  }

  async create(data: NewAccount): Promise<Account> {
    const result = await queryWithRetry<Account>(
      `INSERT INTO accounts (github_installation_id, email, name, tier)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.githubInstallationId, data.email ?? null, data.name ?? null, data.tier ?? 'free'],
    );
    return result.rows[0];
  }

  async update(id: number, data: Partial<Pick<Account, 'email' | 'name' | 'tier'>>): Promise<Account | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.email !== undefined) {
      sets.push(`email = $${idx++}`);
      values.push(data.email);
    }
    if (data.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.tier !== undefined) {
      sets.push(`tier = $${idx++}`);
      values.push(data.tier);
    }

    if (sets.length === 0) {
      return this.findById(id);
    }

    for (const clause of sets) {
      const colName = clause.split('=')[0].trim();
      validateSqlIdentifier(colName);
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await queryWithRetry<Account>(
      `UPDATE accounts SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  async delete(id: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM accounts WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async list(limit = 50, offset = 0): Promise<Account[]> {
    const result = await queryWithRetry<Account>('SELECT * FROM accounts ORDER BY id DESC LIMIT $1 OFFSET $2', [
      limit,
      offset,
    ]);
    return result.rows;
  }
}

export const accountsRepository = new AccountsRepository();
