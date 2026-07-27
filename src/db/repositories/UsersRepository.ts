import crypto from 'node:crypto';
import { queryWithRetry } from '../connection.js';
import type { User, NewUser } from '../types/index.js';

export class UsersRepository {
  async findByEmail(email: string): Promise<User | undefined> {
    const result = await queryWithRetry<User>(
      'SELECT id, email, password_hash, name, created_at, updated_at FROM users WHERE email = $1',
      [email],
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<User | undefined> {
    const result = await queryWithRetry<User>(
      'SELECT id, email, password_hash, name, created_at, updated_at FROM users WHERE id = $1',
      [id],
    );
    return result.rows[0];
  }

  async findBySupabaseUid(uid: string): Promise<User | undefined> {
    const result = await queryWithRetry<User>(
      'SELECT id, email, password_hash, name, created_at, updated_at FROM users WHERE id = $1',
      [uid],
    );
    return result.rows[0];
  }

  async create(data: NewUser): Promise<User> {
    const result = await queryWithRetry<User>(
      `INSERT INTO users (id, email, password_hash, name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, password_hash, name, created_at, updated_at`,
      [data.id ?? crypto.randomUUID(), data.email, data.passwordHash ?? '', data.name ?? null],
    );
    return result.rows[0];
  }

  async update(id: string, data: { name?: string }): Promise<User | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const result = await queryWithRetry<User>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, password_hash, name, created_at, updated_at`,
      values,
    );
    return result.rows[0];
  }
}

export const usersRepository = new UsersRepository();
