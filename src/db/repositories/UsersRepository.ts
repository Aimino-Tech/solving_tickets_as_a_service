import { queryWithRetry } from '../connection.js';
import type { User, NewUser } from '../types/index.js';

const USER_COLUMNS = 'id, email, password_hash AS "passwordHash", name, created_at AS "createdAt", updated_at AS "updatedAt"';

export class UsersRepository {
  async findByEmail(email: string): Promise<User | undefined> {
    const result = await queryWithRetry<User>(
      `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
      [email],
    );
    return result.rows[0];
  }

  async findById(id: number): Promise<User | undefined> {
    const result = await queryWithRetry<User>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  }

  async create(data: NewUser): Promise<User> {
    const result = await queryWithRetry<User>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING ${USER_COLUMNS}`,
      [data.email, data.passwordHash, data.name ?? null],
    );
    return result.rows[0];
  }

  async update(id: number, data: { name?: string }): Promise<User | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(data.name);
    }

    if (sets.length === 0) {
      return this.findById(id);
    }

    sets.push('updated_at = NOW()');
    values.push(id);

    const result = await queryWithRetry<User>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${USER_COLUMNS}`,
      values,
    );
    return result.rows[0];
  }
}

export const usersRepository = new UsersRepository();
