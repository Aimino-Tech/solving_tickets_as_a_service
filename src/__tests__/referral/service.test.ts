/**
 * Unit tests for src/referral/service.ts — ReferralService logic.
 *
 * Strategy: stub queryWithRetry per SQL fragment so the real service logic
 * (normalization, idempotency, qualification gating, code generation, stats
 * aggregation) runs against deterministic fake DB responses.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockCredit = vi.fn();

vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery }));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../db/repositories/CreditsRepository.js', () => ({
  creditsRepository: { credit: mockCredit },
}));

const QUALIFICATION_MESSAGE =
  'Reward is pending qualification — your friend must complete their first fix run';

/**
 * Route every queryWithRetry call to a canned response by matching the SQL
 * string. Unknown SQL throws so tests fail loudly on surprise queries.
 * First matching needle wins — order matters for overlapping SQL.
 */
function mockDb(calls: Array<[needle: string, result: unknown]>) {
  mockQuery.mockImplementation(async (sql: string) => {
    for (const [needle, result] of calls) {
      if (sql.includes(needle)) return result;
    }
    throw new Error(`Unexpected SQL in test: ${sql.slice(0, 120)}`);
  });
}

// The service is loaded lazily (inside tests) so the hoisted vi.mock
// factories above see initialized mock consts (same pattern as
// src/__tests__/credits/routes.test.ts).
let svc: import('../../referral/service.js').ReferralService;

async function loadService(): Promise<import('../../referral/service.js').ReferralService> {
  if (!svc) {
    svc = (await import('../../referral/service.js')).referralService;
  }
  return svc;
}

function rewardRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    referrer_account_id: 42,
    referred_email: 'invitee@example.com',
    referee_account_id: null,
    amount_credits: 0,
    amount_fixes: 10,
    status: 'pending',
    created_at: new Date(),
    claimed_at: null,
    ...overrides,
  };
}

function countInserts(): number {
  return mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO referral_rewards')).length;
}

describe('ReferralService.redeem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unknown code with 400 Invalid referral code', async () => {
    mockDb([['FROM referral_codes WHERE code', { rows: [] }]]);

    await expect((await loadService()).redeem('ZZZZZZZZ', 'new@example.com')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid referral code',
    });
  });

  it('rejects a disposable email domain with 400 before any DB query', async () => {
    await expect((await loadService()).redeem('ABCDEFGH', 'x@mailinator.com')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Disposable email addresses are not allowed',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects self-referral with 400', async () => {
    mockDb([
      ['FROM referral_codes WHERE code', { rows: [{ account_id: 1 }] }],
      ['SELECT email FROM accounts', { rows: [{ email: 'me@example.com' }] }],
    ]);

    await expect((await loadService()).redeem('ABCDEFGH', 'me@example.com')).rejects.toMatchObject({
      statusCode: 400,
      message: 'You cannot redeem your own referral code',
    });
  });

  it('rejects self-referral through a gmail alias', async () => {
    mockDb([
      ['FROM referral_codes WHERE code', { rows: [{ account_id: 1 }] }],
      ['SELECT email FROM accounts', { rows: [{ email: 'me@gmail.com' }] }],
    ]);

    await expect((await loadService()).redeem('ABCDEFGH', 'm.e+alias@gmail.com')).rejects.toMatchObject({
      statusCode: 400,
      message: 'You cannot redeem your own referral code',
    });
  });

  it('is idempotent per email — no duplicate rows on second call', async () => {
    mockDb([
      ['FROM referral_codes WHERE code', { rows: [{ account_id: 1 }] }],
      ['SELECT email FROM accounts', { rows: [{ email: 'other@example.com' }] }],
      ['LOWER(referred_email)', { rows: [{ id: 9 }] }],
    ]);

    await expect((await loadService()).redeem('ABCDEFGH', 'invitee@example.com')).resolves.toBeUndefined();
    expect(countInserts()).toBe(0);
  });

  it('is idempotent across gmail aliases — user@gmail.com then u.ser+tag@gmail.com', async () => {
    // The idempotency check is hit twice: first redeem must see NO existing
    // row (proceed to insert), the alias redeem must see the row (short-circuit).
    let idempotencyChecks = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('LOWER(referred_email)')) {
        idempotencyChecks += 1;
        return idempotencyChecks === 1 ? { rows: [] } : { rows: [{ id: 9 }] };
      }
      if (sql.includes('FROM referral_codes WHERE code')) return { rows: [{ account_id: 1 }] };
      if (sql.includes('SELECT email FROM accounts')) return { rows: [{ email: 'other@example.com' }] };
      if (sql.includes('SELECT id FROM accounts WHERE email')) return { rows: [{ id: 2 }] };
      if (sql.includes('INSERT INTO referral_rewards')) return { rows: [] };
      throw new Error(`Unexpected SQL in test: ${sql.slice(0, 120)}`);
    });

    const service = await loadService();
    await service.redeem('ABCDEFGH', 'user@gmail.com');
    const insertsAfterFirst = countInserts();
    expect(insertsAfterFirst).toBe(2);

    // Alias form normalizes to the same email, hits the existing row,
    // and inserts nothing.
    await service.redeem('ABCDEFGH', 'u.ser+tag@gmail.com');
    expect(countInserts()).toBe(insertsAfterFirst);
  });

  it('is idempotent across non-gmail +tags — dev@example.com then dev+spam@example.com', async () => {
    let idempotencyChecks = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('LOWER(referred_email)')) {
        idempotencyChecks += 1;
        return idempotencyChecks === 1 ? { rows: [] } : { rows: [{ id: 9 }] };
      }
      if (sql.includes('FROM referral_codes WHERE code')) return { rows: [{ account_id: 1 }] };
      if (sql.includes('SELECT email FROM accounts')) return { rows: [{ email: 'other@example.com' }] };
      if (sql.includes('SELECT id FROM accounts WHERE email')) return { rows: [{ id: 2 }] };
      if (sql.includes('INSERT INTO referral_rewards')) return { rows: [] };
      throw new Error(`Unexpected SQL in test: ${sql.slice(0, 120)}`);
    });

    const service = await loadService();
    await service.redeem('ABCDEFGH', 'dev@example.com');
    const insertsAfterFirst = countInserts();
    expect(insertsAfterFirst).toBe(2);

    // +tag on a non-gmail domain must normalize to the base email (farming vector).
    await service.redeem('ABCDEFGH', 'dev+spam@example.com');
    expect(countInserts()).toBe(insertsAfterFirst);
  });

  it('creates both rewards on a fresh redemption with the referee account linked', async () => {
    mockDb([
      ['FROM referral_codes WHERE code', { rows: [{ account_id: 1 }] }],
      ['SELECT email FROM accounts', { rows: [{ email: 'other@example.com' }] }],
      ['LOWER(referred_email)', { rows: [] }],
      ['SELECT id FROM accounts WHERE email', { rows: [{ id: 2 }] }],
      ['INSERT INTO referral_rewards', { rows: [] }],
    ]);

    await (await loadService()).redeem('ABCDEFGH', 'invitee@example.com');

    expect(countInserts()).toBe(2);
    // referee_account_id (3rd param) is the referee's account id on BOTH rows,
    // and both rewards grant 10 fixes (4th param) with 0 credits.
    for (const [sql, params] of mockQuery.mock.calls) {
      if (String(sql).includes('INSERT INTO referral_rewards')) {
        expect(String(sql)).toContain('amount_fixes');
        expect((params as unknown[])[2]).toBe(2);
        expect((params as unknown[])[3]).toBe(10);
      }
    }
  });
});

describe('ReferralService.getOrCreateCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the existing code without inserting', async () => {
    mockDb([['SELECT code FROM referral_codes WHERE account_id', { rows: [{ code: 'STABLE42' }] }]]);

    await expect((await loadService()).getOrCreateCode(42)).resolves.toBe('STABLE42');
    const inserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO referral_codes'),
    );
    expect(inserts).toHaveLength(0);
  });

  it('generates an 8-char code from the base32 alphabet', async () => {
    mockDb([
      ['SELECT code FROM referral_codes WHERE account_id', { rows: [] }],
      ['INSERT INTO referral_codes', { rows: [] }],
    ]);

    const code = await (await loadService()).getOrCreateCode(42);

    // RFC 4648 base32 alphabet: A-Z and 2-7 (digits 0/1/8/9 excluded)
    expect(code).toMatch(/^[A-Z2-7]{8}$/);
    expect(code).not.toMatch(/[0189]/);
  });
});

describe('ReferralService.claimReward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks the claim when the referee has no completed run', async () => {
    mockDb([
      ['SELECT referee_account_id', { rows: [{ referee_account_id: 5 }] }],
      ['FROM runs', { rows: [] }],
    ]);

    await expect((await loadService()).claimReward(42, 7)).rejects.toMatchObject({
      statusCode: 400,
      message: QUALIFICATION_MESSAGE,
    });
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('blocks the claim when the reward has no referee account link', async () => {
    mockDb([['SELECT referee_account_id', { rows: [{ referee_account_id: null }] }]]);

    await expect((await loadService()).claimReward(42, 7)).rejects.toMatchObject({
      statusCode: 400,
      message: QUALIFICATION_MESSAGE,
    });
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('grants fixes once the referee completed a run, and returns the new allowance', async () => {
    mockDb([
      ['SELECT referee_account_id', { rows: [{ referee_account_id: 5 }] }],
      ['FROM runs', { rows: [{ id: 11 }] }],
      ["status = 'claimed'", { rows: [rewardRow({ status: 'claimed', claimed_at: new Date() })] }],
      ['SET referral_fixes_remaining', { rows: [{ referral_fixes_remaining: 10 }], rowCount: 1 }],
    ]);

    const result = await (await loadService()).claimReward(42, 7);

    expect(result.claimed).toBe(true);
    expect(result.newAllowance).toBe(10);
    expect(result.reward.status).toBe('claimed');
    expect(result.reward.amountFixes).toBe(10);
    // Credits are no longer granted for referral rewards (AIM-4643).
    expect(mockCredit).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith(
      `UPDATE accounts
       SET referral_fixes_remaining = referral_fixes_remaining + $1
       WHERE id = $2
       RETURNING referral_fixes_remaining`,
      [10, 42],
    );
  });

  it('rejects a second claim of the same reward with 400 (double-claim protection)', async () => {
    // Another claimant won the race: the qualification gate passes, but the
    // atomic UPDATE finds no pending/qualified row → already claimed.
    mockDb([
      ['SELECT referee_account_id', { rows: [{ referee_account_id: 5 }] }],
      ['FROM runs', { rows: [{ id: 11 }] }],
      ["status = 'claimed'", { rows: [] }],
      ['AND referrer_account_id', { rows: [{ id: 7 }] }],
    ]);

    await expect((await loadService()).claimReward(42, 7)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Reward already claimed',
    });
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('claims a qualified reward (gate allows pending OR qualified)', async () => {
    mockDb([
      ['SELECT referee_account_id', { rows: [{ referee_account_id: 5 }] }],
      ['FROM runs', { rows: [{ id: 11 }] }],
      ["status = 'claimed'", { rows: [rewardRow({ status: 'claimed', claimed_at: new Date() })] }],
      ['SET referral_fixes_remaining', { rows: [{ referral_fixes_remaining: 10 }], rowCount: 1 }],
    ]);

    const result = await (await loadService()).claimReward(42, 7);
    expect(result.reward.status).toBe('claimed');
    expect(result.newAllowance).toBe(10);
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('returns 404 for a reward that is not the caller\'s', async () => {
    mockDb([['SELECT referee_account_id', { rows: [] }]]);

    await expect((await loadService()).claimReward(42, 999)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Reward not found',
    });
  });
});

describe('ReferralService.registerClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true and increments clicks for a known code', async () => {
    mockDb([['UPDATE referral_codes SET clicks', { rows: [], rowCount: 1 }]]);

    await expect((await loadService()).registerClick('ABCDEFGH')).resolves.toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE referral_codes SET clicks = clicks + 1 WHERE code = $1',
      ['ABCDEFGH'],
    );
  });

  it('returns false for an unknown code', async () => {
    mockDb([['UPDATE referral_codes SET clicks', { rows: [], rowCount: 0 }]]);

    await expect((await loadService()).registerClick('ZZZZZZZZ')).resolves.toBe(false);
  });

  it('returns false for an empty code without querying', async () => {
    await expect((await loadService()).registerClick('   ')).resolves.toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('ReferralService.getStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates clicks, invites and fixes for the account', async () => {
    mockDb([
      ['SELECT COALESCE(clicks', { rows: [{ clicks: 12 }] }],
      ['COUNT(*)', { rows: [{ invited: 3, earned: 20, pending: 10 }] }],
    ]);

    await expect((await loadService()).getStats(42)).resolves.toEqual({
      totalClicks: 12,
      totalInvited: 3,
      totalEarnedFixes: 20,
      pendingFixes: 10,
    });
  });

  it('returns 0 for every field when there is no data', async () => {
    mockDb([
      ['SELECT COALESCE(clicks', { rows: [{ clicks: 0 }] }],
      ['COUNT(*)', { rows: [{ invited: 0, earned: 0, pending: 0 }] }],
    ]);

    await expect((await loadService()).getStats(42)).resolves.toEqual({
      totalClicks: 0,
      totalInvited: 0,
      totalEarnedFixes: 0,
      pendingFixes: 0,
    });
  });
});

describe('ReferralService.consumeReferralFix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('consumes one fix and returns true when the allowance is positive', async () => {
    mockDb([
      ['WHERE github_installation_id', { rows: [{ id: 42 }] }],
      ['SET referral_fixes_remaining', { rows: [], rowCount: 1 }],
    ]);

    await expect((await loadService()).consumeReferralFix(42)).resolves.toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE accounts SET referral_fixes_remaining = referral_fixes_remaining - 1 WHERE id = $1 AND referral_fixes_remaining > 0',
      [42],
    );
  });

  it('resolves the internal id via direct id match when no installation matches', async () => {
    mockDb([
      ['WHERE github_installation_id', { rows: [] }],
      ['WHERE id = $1 LIMIT 1', { rows: [{ id: 42 }] }],
      ['SET referral_fixes_remaining', { rows: [], rowCount: 1 }],
    ]);

    await expect((await loadService()).consumeReferralFix(42)).resolves.toBe(true);
  });

  it('returns false when no allowance remains (rowCount 0)', async () => {
    mockDb([
      ['WHERE github_installation_id', { rows: [{ id: 42 }] }],
      ['SET referral_fixes_remaining', { rows: [], rowCount: 0 }],
    ]);

    await expect((await loadService()).consumeReferralFix(42)).resolves.toBe(false);
  });

  it('returns false when no matching account exists', async () => {
    mockDb([
      ['WHERE github_installation_id', { rows: [] }],
      ['WHERE id = $1 LIMIT 1', { rows: [] }],
    ]);

    await expect((await loadService()).consumeReferralFix(42)).resolves.toBe(false);
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('SET referral_fixes_remaining'),
      expect.anything(),
    );
  });

  it('fails closed (returns false) on a DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection lost'));

    await expect((await loadService()).consumeReferralFix(42)).resolves.toBe(false);
  });
});

describe('ReferralService.listRewards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps pending 1/2 without a run and qualified 2/2 with a run', async () => {
    // Runs check is hit once per row: referee 5 has no run, referee 6 has one.
    let runsChecks = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM runs')) {
        runsChecks += 1;
        return runsChecks === 1 ? { rows: [] } : { rows: [{ id: 21 }] };
      }
      if (sql.includes('ORDER BY created_at')) {
        return {
          rows: [
            rewardRow({ id: 1, referee_account_id: 5 }),
            rewardRow({ id: 2, referee_account_id: 6 }),
          ],
        };
      }
      if (sql.includes('status = $1 WHERE id = $2')) return { rows: [] };
      throw new Error(`Unexpected SQL in test: ${sql.slice(0, 120)}`);
    });

    const rewards = await (await loadService()).listRewards(42);

    expect(rewards[0].status).toBe('pending');
    expect(rewards[0].qualificationProgress).toEqual({ completedSteps: 1, totalSteps: 2 });
    expect(rewards[1].status).toBe('qualified');
    expect(rewards[1].qualificationProgress).toEqual({ completedSteps: 2, totalSteps: 2 });
    // Opportunistic persistence for the qualified row only.
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE referral_rewards SET status = $1 WHERE id = $2 AND status = $3',
      ['qualified', 2, 'pending'],
    );
  });

  it('keeps claimed rows claimed and passes through expired/fraud', async () => {
    mockDb([
      [
        'ORDER BY created_at',
        {
          rows: [
            rewardRow({ id: 1, status: 'claimed', referee_account_id: 5, claimed_at: new Date() }),
            rewardRow({ id: 2, status: 'expired', referee_account_id: 6 }),
            rewardRow({ id: 3, status: 'fraud', referee_account_id: 7 }),
          ],
        },
      ],
      ['FROM runs', { rows: [] }],
    ]);

    const rewards = await (await loadService()).listRewards(42);

    expect(rewards.map((r) => r.status)).toEqual(['claimed', 'expired', 'fraud']);
    expect(rewards[0].qualificationProgress).toBeUndefined();
  });
});
