import { describe, expect, it, vi } from 'vitest';
import type { AccountTier, ModelOption, TaskComplexity } from '../../proxy/modelRouter.js';
import { ModelRouter } from '../../proxy/modelRouter.js';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn(() => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
    })),
  },
}));

vi.mock('../../config.js', () => ({
  config: {
    opencode: {
      model: 'anthropic/claude-sonnet-4-20250514',
      fallbackModels: ['claude-opus-4-20250514'],
    },
  },
}));

function makeModel(id: string, overrides: Partial<ModelOption> = {}): ModelOption {
  return {
    id,
    name: id,
    available: true,
    costMultiplier: 1.0,
    capabilities: ['code', 'reasoning'],
    ...overrides,
  };
}

function makeRegistry(
  overrides: Partial<Record<TaskComplexity, Partial<Record<AccountTier, ModelOption[]>>>> = {},
): Record<TaskComplexity, Record<AccountTier, ModelOption[]>> {
  const complexityList: TaskComplexity[] = ['triage', 'fix', 'review'];
  const tierList: AccountTier[] = ['free', 'pro', 'enterprise'];
  const registry = {} as Record<TaskComplexity, Record<AccountTier, ModelOption[]>>;
  for (const complexity of complexityList) {
    registry[complexity] = {} as Record<AccountTier, ModelOption[]>;
    for (const tier of tierList) {
      registry[complexity][tier] = [
        makeModel('model-a', { costMultiplier: 0.1, capabilities: ['fast', 'code', 'reasoning'] }),
        makeModel('model-b', { costMultiplier: 1.0 }),
        makeModel('model-c', { costMultiplier: 1.5 }),
      ];
    }
  }
  for (const complexity of Object.keys(overrides) as TaskComplexity[]) {
    for (const tier of Object.keys(overrides[complexity] ?? {}) as AccountTier[]) {
      registry[complexity][tier] = overrides[complexity]![tier]!;
    }
  }
  return registry;
}

describe('ModelRouter', () => {
  it('selects the first available model for a (complexity, tier) pair', async () => {
    const router = new ModelRouter(makeRegistry());
    const result = await router.selectModel({ complexity: 'fix', accountTier: 'pro' });
    expect(result.model).toBe('model-a');
    expect(result.modelName).toBe('model-a');
    expect(result.confidence).toBe('high');
    expect(result.available).toBe(true);
    expect(result.usedFallback).toBe(false);
  });

  it('defaults to the free tier when no accountTier is provided', async () => {
    const router = new ModelRouter(makeRegistry());
    const result = await router.selectModel({ complexity: 'triage' });
    expect(result.model).toBe('model-a');
    expect(result.fallbackChain[0]).toBe('model-a');
  });

  it('returns the preferred model when it is available', async () => {
    const router = new ModelRouter(makeRegistry());
    const result = await router.selectModel({ complexity: 'fix', preferredModel: 'model-c' });
    expect(result.model).toBe('model-c');
    expect(result.confidence).toBe('high');
    expect(result.usedFallback).toBe(false);
    expect(result.fallbackChain).toEqual(['preferred:model-c']);
  });

  it('falls back to the registry when the preferred model is unavailable', async () => {
    const router = new ModelRouter(makeRegistry());
    const result = await router.selectModel({ complexity: 'fix', preferredModel: 'model-unknown' });
    expect(result.model).toBe('model-a');
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackChain).toEqual(['preferred:model-unknown', 'model-a']);
  });

  it('skips the preferred model when the registry is unavailable and returns the default model', async () => {
    const router = new ModelRouter(
      makeRegistry({
        fix: {
          free: [
            makeModel('unavailable-model', { available: false }),
            makeModel('other-unavailable-model', { available: false }),
          ],
        },
      }),
    );
    const result = await router.selectModel({ complexity: 'fix', preferredModel: 'model-unknown' });
    expect(result.model).toBe('anthropic/claude-sonnet-4-20250514');
    expect(result.confidence).toBe('low');
    expect(result.available).toBe(false);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackChain.at(-1)).toBe('default:anthropic/claude-sonnet-4-20250514');
  });

  it('falls through to the next registry model when the first is unavailable', async () => {
    const router = new ModelRouter(makeRegistry());
    router.setModelAvailability('model-a', false);
    const result = await router.selectModel({ complexity: 'fix' });
    expect(result.model).toBe('model-b');
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackChain).toEqual(['model-a', 'model-b']);
  });

  it('returns the default model when no registry model is available', async () => {
    const router = new ModelRouter(makeRegistry());
    router.setModelAvailability('model-a', false);
    router.setModelAvailability('model-b', false);
    router.setModelAvailability('model-c', false);
    const result = await router.selectModel({ complexity: 'review' });
    expect(result.model).toBe('anthropic/claude-sonnet-4-20250514');
    expect(result.confidence).toBe('low');
    expect(result.available).toBe(false);
    expect(result.fallbackChain).toEqual([
      'model-a',
      'model-b',
      'model-c',
      'default:anthropic/claude-sonnet-4-20250514',
    ]);
  });

  it('does not run availability checks when skipAvailabilityCheck is set', async () => {
    const router = new ModelRouter(
      makeRegistry({
        fix: {
          free: [makeModel('model-a', { available: false })],
        },
      }),
    );
    const result = await router.selectModel({ complexity: 'fix', skipAvailabilityCheck: true });
    expect(result.model).toBe('model-a');
    expect(result.available).toBe(true);
  });

  it('checks availability against the registry', async () => {
    const router = new ModelRouter(
      makeRegistry({
        fix: { free: [makeModel('present-model', { available: true })] },
      }),
    );
    await expect(router.checkAvailability('present-model')).resolves.toBe(true);
  });

  it('checks availability against config fallback models when not in registry', async () => {
    const router = new ModelRouter(makeRegistry());
    await expect(router.checkAvailability('claude-opus-4-20250514')).resolves.toBe(true);
    await expect(router.checkAvailability('unknown-model')).resolves.toBe(false);
  });

  it('returns true (fail-open) when the availability check throws', async () => {
    const router = new ModelRouter();
    vi.spyOn(router, 'checkAvailability').mockRejectedValueOnce(new Error('boom'));
    const result = await router.selectModel({ complexity: 'fix' });
    expect(result.model).toBe('anthropic/claude-sonnet-4-20250514');
    expect(result.available).toBe(false);
  });

  it('updates the registry via setModels and getRegistry reflects the change', async () => {
    const router = new ModelRouter(makeRegistry());
    const customModels = [makeModel('custom-model', { costMultiplier: 0.5 })];
    router.setModels('triage', 'pro', customModels);
    const registry = router.getRegistry();
    expect(registry.triage.pro).toEqual(customModels);
    expect(registry.triage.free).toHaveLength(3);
  });

  it('getRegistry returns a snapshot that does not mutate internal state', async () => {
    const router = new ModelRouter(makeRegistry());
    const snapshot = router.getRegistry();
    snapshot.fix.free = [makeModel('tampered')];
    const after = router.getRegistry();
    expect(after.fix.free).toHaveLength(3);
  });

  it('setModelAvailability toggles availability across all tiers and complexities', async () => {
    const router = new ModelRouter(makeRegistry());
    router.setModelAvailability('model-a', false);
    const registry = router.getRegistry();
    for (const complexity of Object.keys(registry) as TaskComplexity[]) {
      for (const tier of Object.keys(registry[complexity]) as AccountTier[]) {
        const entry = registry[complexity][tier].find((m) => m.id === 'model-a');
        expect(entry?.available).toBe(false);
      }
    }
  });
});
