/**
 * Unit tests for src/db/repositories/CreditsRepository.ts — Balance, credit, deduct.
 *
 * Strategy: mock queryWithRetry for getBalance/getTransactions (which use the
 * retry helper), and mock getPool().connect() for credit/deduct (which use
 * raw pg.Client transactions).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// queryWithRetry is used by getBalance and getTransactions
const mockQueryWithRetry = vi.fn();
vi.mock('../../../db/connection.js', () => ({
  getPool: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    }),
  })),
  queryWithRetry: mockQueryWithRetry,
}));

vi.mock('../../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('CreditsRepository', () => {
  let repo: import('../../../db/repositories/CreditsRepository.js').CreditsRepository;
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    const connectionMod = await import('../../../db/connection.js');
    (connectionMod.getPool as ReturnType<typeof vi.fn>).mockReturnValue(mockPool);

    const mod = await import('../../../db/repositories/CreditsRepository.js');
    repo = new mod.CreditsRepository();
  });

  // -----------------------------------------------------------------------
  // getBalance
  // -----------------------------------------------------------------------

  describe('getBalance', () => {
    it('returns existing balance when row found', async () => {
      const expected = { id: 1, accountId: 42, balance: 500, lifetimeCredits: 1000, createdAt: new Date(), updatedAt: new Date() };
      mockQueryWithRetry.mockResolvedValue({ rows: [expected] });

      const result = await repo.getBalance(42);
      expect(result).toEqual(expected);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        'SELECT * FROM credit_balances WHERE account_id = $1',
        [42],
      );
    });

    it('creates zero-balance row when none exists', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, accountId: 42, balance: 0, lifetimeCredits: 0, createdAt: new Date(), updatedAt: new Date() }],
        });

      const result = await repo.getBalance(42);
      expect(result.balance).toBe(0);
      expect(result.lifetimeCredits).toBe(0);
      expect(mockQueryWithRetry).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // credit
  // -----------------------------------------------------------------------

  describe('credit', () => {
    it('adds credits and records transaction using DB transaction (S10)', async () => {
      const expectedBalance = { id: 1, accountId: 42, balance: 500, lifetimeCredits: 500, createdAt: new Date(), updatedAt: new Date() };

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [expectedBalance] }) // INSERT ... RETURNING
        .mockResolvedValueOnce(undefined) // INSERT transaction
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await repo.credit(42, 500, { type: 'purchase', description: 'Credit purchase' });

      expect(result).toEqual(expectedBalance);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO credit_balances'),
        [42, 500],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO credit_transactions'),
        [42, 500, 'purchase', 'Credit purchase', null],
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('rolls back and re-throws on error', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('INSERT failed')); // INSERT fails

      await expect(repo.credit(42, 500)).rejects.toThrow('INSERT failed');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('throws when amount is zero or negative', async () => {
      await expect(repo.credit(42, 0)).rejects.toThrow('Credit amount must be positive');
      await expect(repo.credit(42, -10)).rejects.toThrow('Credit amount must be positive');
    });

    it('uses defaults for optional options', async () => {
      const expectedBalance = { id: 1, accountId: 42, balance: 100, lifetimeCredits: 100, createdAt: new Date(), updatedAt: new Date() };
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [expectedBalance] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await repo.credit(42, 100);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO credit_transactions'),
        [42, 100, 'purchase', null, null],
      );
    });

    it('passes stripePaymentIntentId when provided', async () => {
      const expectedBalance = { id: 1, accountId: 42, balance: 1000, lifetimeCredits: 1000, createdAt: new Date(), updatedAt: new Date() };
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [expectedBalance] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await repo.credit(42, 1000, { stripePaymentIntentId: 'pi_abc123' });
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO credit_transactions'),
        [42, 1000, 'purchase', null, 'pi_abc123'],
      );
    });
  });

  // -----------------------------------------------------------------------
  // deduct
  // -----------------------------------------------------------------------

  describe('deduct', () => {
    it('deducts credits and records transaction when balance sufficient', async () => {
      const currentBalance = { id: 1, accountId: 42, balance: 500, lifetimeCredits: 1000 };
      const newBalance = { id: 1, accountId: 42, balance: 400, lifetimeCredits: 1000 };

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [currentBalance] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [newBalance] }) // UPDATE ... RETURNING
        .mockResolvedValueOnce(undefined) // INSERT transaction
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await repo.deduct(42, 100, { description: 'Fix run' });

      expect(result).toEqual(newBalance);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM credit_balances WHERE account_id'),
        [42],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE credit_balances'),
        [42, 100],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO credit_transactions'),
        [42, -100, 'Fix run'],
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('throws when balance is insufficient (S11)', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, accountId: 42, balance: 10, lifetimeCredits: 100 }] }) // SELECT
        .mockResolvedValueOnce(undefined);

      await expect(repo.deduct(42, 100)).rejects.toThrow(
        'Insufficient credits: 10 available, 100 required',
      );
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('throws when balance row does not exist (zero balance)', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT — no row
        .mockResolvedValueOnce(undefined);

      await expect(repo.deduct(42, 50)).rejects.toThrow(
        'Insufficient credits: 0 available, 50 required',
      );
    });

    it('rolls back on error and re-throws', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('DB error'));

      await expect(repo.deduct(42, 50)).rejects.toThrow('DB error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('throws when amount is zero or negative', async () => {
      await expect(repo.deduct(42, 0)).rejects.toThrow('Deduction amount must be positive');
      await expect(repo.deduct(42, -10)).rejects.toThrow('Deduction amount must be positive');
    });

    it('uses null description when not provided', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ id: 1, accountId: 42, balance: 100, lifetimeCredits: 100 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, accountId: 42, balance: 50, lifetimeCredits: 100 }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await repo.deduct(42, 50);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO credit_transactions'),
        [42, -50, null],
      );
    });
  });

  // -----------------------------------------------------------------------
  // getTransactions
  // -----------------------------------------------------------------------

  describe('getTransactions', () => {
    it('returns paginated transactions', async () => {
      const txns = [
        { id: 1, accountId: 42, amount: 100, type: 'purchase', createdAt: new Date() },
        { id: 2, accountId: 42, amount: -50, type: 'usage', createdAt: new Date() },
      ];
      mockQueryWithRetry.mockResolvedValue({ rows: txns });

      const result = await repo.getTransactions(42, 10, 0);
      expect(result).toEqual(txns);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM credit_transactions'),
        [42, 10, 0],
      );
    });

    it('uses default pagination values', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });
      await repo.getTransactions(42);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.any(String),
        [42, 50, 0],
      );
    });
  });
});
