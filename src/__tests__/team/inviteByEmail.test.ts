import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryWithRetry } = vi.hoisted(() => ({ queryWithRetry: vi.fn() }));

vi.mock('../../db/connection.js', () => ({ queryWithRetry }));
vi.mock('../../db/repositories/index.js', () => ({
  teamsRepository: {
    findById: vi.fn(),
    getMembers: vi.fn(),
    addMember: vi.fn(),
  },
}));
vi.mock('../../audit/repository.js', () => ({
  auditRepository: {},
}));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

import { inviteByEmail } from '../../team/index.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inviteByEmail (AIM-4496)', () => {
  it('adds the account directly when an account matches the email', async () => {
    const { teamsRepository } = await import('../../db/repositories/index.js');
    (teamsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, name: 'Team', ownerAccountId: 1 });
    (teamsRepository.getMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { accountId: 2, role: 'admin' },
    ]);
    queryWithRetry.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM accounts WHERE LOWER(email)')) {
        return { rows: [{ id: 42 }] };
      }
      return { rows: [] };
    });

    const result = await inviteByEmail({
      teamId: 1,
      email: 'someone@example.com',
      invitedByAccountId: 2,
    });

    expect(result.accountId).toBe(42);
    expect(result.inviteId).toBeUndefined();
    expect((teamsRepository.addMember as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('creates a pending invite when no account exists for the email', async () => {
    const { teamsRepository } = await import('../../db/repositories/index.js');
    (teamsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, name: 'Team', ownerAccountId: 1 });
    (teamsRepository.getMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { accountId: 2, role: 'admin' },
    ]);
    queryWithRetry.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO team_invites')) {
        return { rows: [{ id: 77 }] };
      }
      return { rows: [] };
    });

    const result = await inviteByEmail({
      teamId: 1,
      email: 'new-user@example.com',
      invitedByAccountId: 2,
    });

    expect(result.inviteId).toBe(77);
    expect(result.inviteToken).toBeTruthy();
    expect(result.accountId).toBeUndefined();
  });

  it('rejects an invalid email', async () => {
    await expect(
      inviteByEmail({ teamId: 1, email: 'not-an-email', invitedByAccountId: 2 }),
    ).rejects.toThrow('valid email');
  });

  it('rejects when the inviter is not an admin', async () => {
    const { teamsRepository } = await import('../../db/repositories/index.js');
    (teamsRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, name: 'Team', ownerAccountId: 1 });
    (teamsRepository.getMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { accountId: 2, role: 'viewer' },
    ]);
    queryWithRetry.mockResolvedValue({ rows: [] });

    await expect(
      inviteByEmail({ teamId: 1, email: 'a@b.com', invitedByAccountId: 2 }),
    ).rejects.toThrow('Only admins can invite members');
  });
});
