import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryWithRetry } = vi.hoisted(() => ({ queryWithRetry: vi.fn() }));

vi.mock('../../db/connection.js', () => ({ queryWithRetry }));

import { exportUserData, eraseUserData, anonymizeUserData } from '../../gdpr/service.js';

beforeEach(() => {
  queryWithRetry.mockReset();
});

describe('GDPR service (AIM-4496)', () => {
  it('exportUserData returns null user for unknown id', async () => {
    queryWithRetry.mockResolvedValue({ rows: [] });
    const result = await exportUserData('999999');
    expect(result.user).toBeNull();
    expect(result.exportedAt).toBeTruthy();
  });

  it('eraseUserData returns false for unknown user', async () => {
    queryWithRetry.mockResolvedValue({ rows: [] });
    const erased = await eraseUserData('999999');
    expect(erased).toBe(false);
  });

  it('anonymizeUserData returns false for unknown user', async () => {
    queryWithRetry.mockResolvedValue({ rows: [] });
    const anonymized = await anonymizeUserData('999999');
    expect(anonymized).toBe(false);
  });

  it('exportUserData collects data across user-scoped tables', async () => {
    queryWithRetry.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users WHERE')) return { rows: [{ id: 1, email: 'a@b.c' }] };
      return { rows: [{ a: 1 }] };
    });
    const result = await exportUserData('1');
    expect(result.user).toEqual({ id: 1, email: 'a@b.c' });
    expect(result.oauth).toHaveLength(1);
    expect(result.runs).toHaveLength(1);
    expect(result.consent).toHaveLength(1);
  });

  it('eraseUserData deletes user-scoped tables and the users row', async () => {
    const calls: string[] = [];
    queryWithRetry.mockImplementation(async (sql: string) => {
      calls.push(String(sql).slice(0, 50));
      if (String(sql).includes('SELECT id FROM users WHERE id = $1')) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });
    const erased = await eraseUserData('1');
    expect(erased).toBe(true);
    expect(calls.some((c) => c.includes('DELETE FROM github_oauth_tokens'))).toBe(true);
    expect(calls.some((c) => c.includes('DELETE FROM users'))).toBe(true);
  });

  it('anonymizeUserData replaces email and name', async () => {
    queryWithRetry.mockImplementation(async (sql: string) => {
      if (String(sql).includes('SELECT email, name FROM users')) {
        return { rows: [{ email: 'real@example.com', name: 'Real Name' }] };
      }
      return { rows: [] };
    });
    const anonymized = await anonymizeUserData('1');
    expect(anonymized).toBe(true);
    const updateCall = queryWithRetry.mock.calls.find((c) => String(c[0]).includes('UPDATE users SET email'));
    expect(updateCall).toBeTruthy();
    expect(String(updateCall![1][0])).toContain('@anonymized.local');
  });
});
