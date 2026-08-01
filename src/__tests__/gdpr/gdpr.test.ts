import { describe, expect, it, vi } from 'vitest';
import { anonymizePii, isAnonymizedEmail } from '../../gdpr/anonymize.js';

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('../../db/connection.js', () => ({
  queryWithRetry: mockQuery,
  isTableNotFoundError: (err: unknown) => err instanceof Error && err.message.includes('does not exist'),
}));

import { eraseUserData, exportUserData, getCookiePreferences, setCookiePreferences } from '../../gdpr/service.js';

describe('anonymizePii (AIM-2999)', () => {
  it('returns anonymized email and name for a real user', () => {
    const result = anonymizePii('jane@example.com', 'Jane Doe');
    expect(result.email).toMatch(/^jane-[a-f0-9]{16}@deleted\.invalid$/);
    expect(result.name).toMatch(/^User [a-f0-9]{8}$/);
    expect(result.email).not.toContain('jane@example.com');
  });

  it('is deterministic for the same input', () => {
    const a = anonymizePii('jane@example.com', 'Jane Doe');
    const b = anonymizePii('jane@example.com', 'Jane Doe');
    expect(a).toEqual(b);
  });

  it('handles missing email', () => {
    const result = anonymizePii(undefined, 'Jane');
    expect(result.email).toBeNull();
    expect(result.name).toBeTruthy();
  });

  it('isAnonymizedEmail detects deleted.invalid addresses', () => {
    expect(isAnonymizedEmail('jane-abc@deleted.invalid')).toBe(true);
    expect(isAnonymizedEmail('jane@example.com')).toBe(false);
    expect(isAnonymizedEmail(null)).toBe(false);
  });
});

describe('GDPR service', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('eraseUserData deletes user, anonymizes account, removes consent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await eraseUserData('user-1', 'jane@example.com');

    expect(result.usersDeleted).toBe(1);
    expect(result.accountsAnonymized).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[1][0]).toMatch(/@deleted\.invalid$/);
  });

  it('eraseUserData tolerates missing tables', async () => {
    mockQuery.mockRejectedValue(new Error('relation "users" does not exist'));

    const result = await eraseUserData('user-1', 'jane@example.com');

    expect(result.usersDeleted).toBe(0);
    expect(result.accountsAnonymized).toBe(0);
  });

  it('exportUserData builds a portable archive', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'user-1',
            email: 'jane@example.com',
            name: 'Jane',
            plan: 'solo',
            subscription_status: 'active',
            created_at: new Date('2025-01-01'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, email: 'jane@example.com', name: 'Jane', plan: 'solo' }],
      });

    const archive = await exportUserData('user-1', 'jane@example.com');

    expect(archive.schema).toBe('stas-user-data-export');
    expect(archive.user.email).toBe('jane@example.com');
    expect(archive.accounts).toHaveLength(1);
    expect(new Date(archive.expiresAt) > new Date(archive.generatedAt)).toBe(true);
  });

  it('setCookiePreferences upserts and returns preferences', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const prefs = await setCookiePreferences('user-1', { analytics: true, marketing: false });

    expect(prefs).toEqual({ analytics: true, marketing: false });
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('ON CONFLICT');
  });

  it('getCookiePreferences returns stored preferences', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ preferences: { analytics: true } }] });

    const prefs = await getCookiePreferences('user-1');

    expect(prefs).toEqual({ analytics: true });
  });

  it('getCookiePreferences returns {} when none stored', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const prefs = await getCookiePreferences('user-1');

    expect(prefs).toEqual({});
  });
});
