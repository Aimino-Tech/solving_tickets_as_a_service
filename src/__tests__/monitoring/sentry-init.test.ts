/**
 * Unit tests for src/monitoring/sentry-init.ts — Sentry initialization side-effect.
 */
import { describe, expect, it, vi } from 'vitest';

const mockInitSentry = vi.fn();
const mockSetTag = vi.fn();

vi.mock('../../monitoring/sentry.js', () => ({ initSentry: mockInitSentry, setTag: mockSetTag }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));

describe('monitoring/sentry-init', () => {
  it('calls initSentry on import', async () => {
    await import('../../monitoring/sentry-init.js');
    expect(mockInitSentry).toHaveBeenCalled();
  });

  it('sets service and runtime tags', async () => {
    vi.resetModules();
    await import('../../monitoring/sentry-init.js');
    expect(mockSetTag).toHaveBeenCalledWith('service', 'syntaro');
    expect(mockSetTag).toHaveBeenCalledWith('runtime', 'node');
  });
});
