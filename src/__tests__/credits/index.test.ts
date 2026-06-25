/**
 * Unit tests for src/credits/index.ts — Credits barrel export.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../credits/routes.js', () => ({ creditRouter: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../credits/middleware.js', () => ({ deductMiddleware: vi.fn(), refundCredits: vi.fn() }));

describe('credits/index', () => {
  it('exports creditRouter, deductMiddleware, refundCredits', async () => {
    const mod = await import('../../credits/index.js');
    expect(mod.creditRouter).toBeDefined();
    expect(mod.deductMiddleware).toBeDefined();
    expect(mod.refundCredits).toBeDefined();
  });
});
