/**
 * Model Router — selects the best AI model for a given task.
 *
 * Supports routing based on:
 *   - Task complexity (triage vs fix vs review)
 *   - Account tier (free / pro / enterprise)
 *   - Model availability with fallback chain
 *
 * ── Design ────────────────────────────────────────────────────────────────────
 * The router maintains a ranked list of models per (complexity, tier) pair.
 * On selection, it tries models in order and returns the first one that is
 * marked as available. If none are available, it falls back to the default
 * model from the Opencode config.
 *
 * Usage:
 *   ```ts
 *   const router = new ModelRouter();
 *   const model = await router.selectModel({
 *     complexity: 'fix',
 *     accountTier: 'pro',
 *   });
 *   // → 'anthropic/claude-sonnet-4-20250514'
 *   ```
 *
 * ── Error Handling ───────────────────────────────────────────────────────────
 * The router never throws on selection — it always falls back to the configured
 * default model. Availability checks are best-effort and fail open.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'model-router' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskComplexity = 'triage' | 'fix' | 'review';

export type AccountTier = 'free' | 'pro' | 'enterprise';

export interface ModelOption {
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Whether the model is currently available for selection */
  available: boolean;
  /** Relative cost multiplier (1.0 = baseline) */
  costMultiplier: number;
  /** Capabilities this model supports */
  capabilities: Array<'code' | 'reasoning' | 'vision' | 'fast'>;
}

export interface ModelSelectionParams {
  /** Task complexity level */
  complexity: TaskComplexity;
  /** Account tier for cost/power selection */
  accountTier?: AccountTier;
  /** Optional preferred model override */
  preferredModel?: string;
  /** Whether to skip availability checks (default: false) */
  skipAvailabilityCheck?: boolean;
}

export interface ModelSelectionResult {
  /** Selected model identifier */
  model: string;
  /** Display name of the selected model */
  modelName: string;
  /** Confidence level in this selection */
  confidence: 'high' | 'medium' | 'low';
  /** Whether a fallback was used */
  usedFallback: boolean;
  /** Fallback chain that was attempted */
  fallbackChain: string[];
  /** Current availability state of the selected model */
  available: boolean;
}

// ---------------------------------------------------------------------------
// Default model registry
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_REGISTRY: Record<TaskComplexity, Record<AccountTier, ModelOption[]>> = {
  triage: {
    free: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', available: true, costMultiplier: 0.3, capabilities: ['fast', 'code'] },
      { id: 'gpt-4o', name: 'GPT-4o', available: true, costMultiplier: 1.0, capabilities: ['code', 'reasoning'] },
    ],
    pro: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', available: true, costMultiplier: 0.3, capabilities: ['fast', 'code'] },
      { id: 'gpt-4o', name: 'GPT-4o', available: true, costMultiplier: 1.0, capabilities: ['code', 'reasoning'] },
    ],
    enterprise: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', available: true, costMultiplier: 0.3, capabilities: ['fast', 'code'] },
      { id: 'gpt-4o', name: 'GPT-4o', available: true, costMultiplier: 1.0, capabilities: ['code', 'reasoning'] },
    ],
  },
  fix: {
    free: [
      { id: 'gpt-4o', name: 'GPT-4o', available: true, costMultiplier: 1.0, capabilities: ['code', 'reasoning'] },
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', available: true, costMultiplier: 1.5, capabilities: ['code', 'reasoning'] },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', available: true, costMultiplier: 0.3, capabilities: ['fast', 'code'] },
    ],
    pro: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', available: true, costMultiplier: 1.5, capabilities: ['code', 'reasoning'] },
      { id: 'gpt-4o', name: 'GPT-4o', available: true, costMultiplier: 1.0, capabilities: ['code', 'reasoning'] },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', available: true, costMultiplier: 0.3, capabilities: ['fast', 'code'] },
    ],
    enterprise: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', available: true, costMultiplier: 1.5, capabilities: ['code', 'reasoning'] },
      { id: 'gpt-4o', name: 'GPT-4o', available: true, costMultiplier: 1.0, capabilities: ['code', 'reasoning'] },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', available: true, costMultiplier: 0.3, capabilities: ['fast', 'code'] },
    ],
  },
  review: {
    free: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', available: true, costMultiplier: 0.3, capabilities: ['fast', 'code'] },
      { id: 'gpt-4o', name: 'GPT-4o', available: true, costMultiplier: 1.0, capabilities: ['code', 'reasoning'] },
    ],
    pro: [
      { id: 'gpt-4o', name: 'GPT-4o', available: true, costMultiplier: 1.0, capabilities: ['code', 'reasoning'] },
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', available: true, costMultiplier: 1.5, capabilities: ['code', 'reasoning'] },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', available: true, costMultiplier: 0.3, capabilities: ['fast', 'code'] },
    ],
    enterprise: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', available: true, costMultiplier: 1.5, capabilities: ['code', 'reasoning'] },
      { id: 'gpt-4o', name: 'GPT-4o', available: true, costMultiplier: 1.0, capabilities: ['code', 'reasoning'] },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', available: true, costMultiplier: 0.3, capabilities: ['fast', 'code'] },
    ],
  },
};

// ---------------------------------------------------------------------------
// ModelRouter
// ---------------------------------------------------------------------------

export class ModelRouter {
  private modelRegistry: Record<TaskComplexity, Record<AccountTier, ModelOption[]>>;
  private defaultModelId: string;

  constructor(
    registry?: Record<TaskComplexity, Record<AccountTier, ModelOption[]>>,
  ) {
    this.modelRegistry = registry ?? structuredClone(DEFAULT_MODEL_REGISTRY);
    this.defaultModelId = config.opencode.model || 'anthropic/claude-sonnet-4-20250514';
  }

  // ── Model selection ──────────────────────────────────────────────────────

  /**
   * Select the best model for a given task.
   *
   * Iterates through the ranked model list for the (complexity, tier) pair,
   * checks availability, and returns the first available model. If none are
   * available, falls back to the configured default Opencode model.
   */
  async selectModel(params: ModelSelectionParams): Promise<ModelSelectionResult> {
    const { complexity, accountTier, preferredModel, skipAvailabilityCheck } = params;
    const tier: AccountTier = accountTier ?? 'free';
    const fallbackChain: string[] = [];

    try {
      // 1. Preferred model override — check if it exists in the registry
      if (preferredModel) {
        fallbackChain.push(`preferred:${preferredModel}`);
        const isAvailable = skipAvailabilityCheck || await this.checkAvailability(preferredModel);
        if (isAvailable) {
          log.info({ model: preferredModel, complexity, tier }, 'Selected preferred model');
          return {
            model: preferredModel,
            modelName: preferredModel,
            confidence: 'high',
            usedFallback: false,
            fallbackChain,
            available: true,
          };
        }
        log.warn({ model: preferredModel }, 'Preferred model unavailable, falling back');
      }

      // 2. Registry-based selection for (complexity, tier)
      const tierModels = this.modelRegistry[complexity]?.[tier];
      if (tierModels && tierModels.length > 0) {
        for (const option of tierModels) {
          fallbackChain.push(option.id);
          const isAvailable = skipAvailabilityCheck || await this.checkAvailability(option.id);
          if (isAvailable) {
            log.info({ model: option.id, complexity, tier, name: option.name }, 'Selected model from registry');
            return {
              model: option.id,
              modelName: option.name,
              confidence: 'high',
              usedFallback: fallbackChain.length > 1,
              fallbackChain,
              available: true,
            };
          }
        }
      }

      // 3. Fallback to default model from config
      fallbackChain.push(`default:${this.defaultModelId}`);
      log.warn(
        { complexity, tier, defaultModel: this.defaultModelId },
        'No model available in registry — falling back to default model',
      );
      return {
        model: this.defaultModelId,
        modelName: this.defaultModelId,
        confidence: 'low',
        usedFallback: true,
        fallbackChain,
        available: false,
      };
    } catch (err) {
      // Fail-open: if the router itself errors, return the default model
      log.error({ err: String(err), complexity, tier }, 'Model router error — falling back to default');
      fallbackChain.push(`error-fallback:${this.defaultModelId}`);
      return {
        model: this.defaultModelId,
        modelName: this.defaultModelId,
        confidence: 'low',
        usedFallback: true,
        fallbackChain,
        available: false,
      };
    }
  }

  // ── Availability check ────────────────────────────────────────────────────

  /**
   * Check whether a model is currently available.
   *
   * In a production setup this could ping a model API health endpoint or
   * check a circuit breaker. For now, we check the registry and also accept
   * the config fallback list.
   */
  async checkAvailability(modelId: string): Promise<boolean> {
    try {
      // Check all registry entries for the model
      for (const complexity of Object.keys(this.modelRegistry) as TaskComplexity[]) {
        for (const tier of Object.keys(this.modelRegistry[complexity]) as AccountTier[]) {
          const found = this.modelRegistry[complexity][tier].find(m => m.id === modelId);
          if (found) return found.available;
        }
      }

      // Not in registry — check if it's in the fallback models list
      const fallbackModels = config.opencode.fallbackModels ?? [];
      return fallbackModels.includes(modelId);
    } catch (err) {
      log.warn({ err: String(err), modelId }, 'Availability check failed — allowing model');
      return true; // fail-open
    }
  }

  // ── Registry management ──────────────────────────────────────────────────

  /**
   * Get the current model registry (read-only snapshot).
   */
  getRegistry(): Record<TaskComplexity, Record<AccountTier, ModelOption[]>> {
    return structuredClone(this.modelRegistry);
  }

  /**
   * Update the model registry for a specific complexity and tier.
   */
  setModels(
    complexity: TaskComplexity,
    tier: AccountTier,
    models: ModelOption[],
  ): void {
    this.modelRegistry[complexity] = {
      ...this.modelRegistry[complexity],
      [tier]: models,
    };
    log.info({ complexity, tier, modelCount: models.length }, 'Model registry updated');
  }

  /**
   * Toggle availability for a model across all complexity/tier entries.
   */
  setModelAvailability(modelId: string, available: boolean): void {
    for (const complexity of Object.keys(this.modelRegistry) as TaskComplexity[]) {
      for (const tier of Object.keys(this.modelRegistry[complexity]) as AccountTier[]) {
        const entry = this.modelRegistry[complexity][tier].find(m => m.id === modelId);
        if (entry) {
          entry.available = available;
        }
      }
    }
    log.info({ modelId, available }, 'Model availability updated');
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const modelRouter = new ModelRouter();
