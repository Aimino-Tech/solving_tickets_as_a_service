/**
 * SYNTARO Proxy Module — wires together rate limiting, model routing,
 * and GitHub Actions dispatch into a cohesive proxy layer.
 *
 * ── Features ─────────────────────────────────────────────────────────────────
 * - Model Router: Selects optimal AI model per task complexity & account tier
 * - GitHub Actions Dispatcher: Triggers CI/CD workflows on target repos
 * - Rate limiting: Re-exports the existing governance rate limiter
 * - Feature-gated via environment config
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   ```ts
 *   import { proxy } from './proxy/index.js';
 *
 *   // Model selection
 *   const model = await proxy.modelRouter.selectModel({
 *     complexity: 'fix',
 *     accountTier: 'pro',
 *   });
 *
 *   // GitHub Actions dispatch
 *   const result = await proxy.githubActionsDispatcher.dispatchWorkflow({
 *     owner: 'myorg',
 *     repo: 'myrepo',
 *     workflowId: 'ci.yml',
 *     ref: 'main',
 *   });
 *   ```
 *
 * ── Initialization ────────────────────────────────────────────────────────────
 * The proxy module is initialized eagerly at import time. Components that are
 * disabled via config will log a warning but won't prevent startup.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { rateLimiter } from '../ratelimit/limiter.js';
import { concurrencyManager } from '../ratelimit/concurrency.js';
import { rateLimitMiddleware } from '../ratelimit/middleware.js';
import { ModelRouter, modelRouter } from './modelRouter.js';
import { GitHubActionsDispatcher, githubActionsDispatcher } from './githubActionsDispatcher.js';

const log = rootLogger.child({ module: 'syntaro-proxy' });

// ---------------------------------------------------------------------------
// Proxy interface
// ---------------------------------------------------------------------------

export interface ProxyModule {
  /** Model router for AI model selection */
  modelRouter: ModelRouter;
  /** GitHub Actions dispatcher for CI/CD workflows */
  githubActionsDispatcher: GitHubActionsDispatcher;
  /** Rate limiter instance (re-exported from governance) */
  rateLimiter: typeof rateLimiter;
  /** Concurrency manager instance (re-exported from governance) */
  concurrencyManager: typeof concurrencyManager;
  /** Rate limit middleware factory */
  rateLimitMiddleware: typeof rateLimitMiddleware;
  /** Whether the proxy module is fully initialized */
  initialized: boolean;
  /** Module metadata */
  meta: {
    modelRouterEnabled: boolean;
    githubActionsDispatchEnabled: boolean;
    hasPat: boolean;
    startedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initializeProxy(): ProxyModule {
  const startedAt = new Date().toISOString();

  const modelRouterEnabled = config.proxy.modelRouterEnabled;
  const githubActionsDispatchEnabled = config.proxy.githubActionsDispatchEnabled;
  const hasPat = !!config.proxy.pat;

  log.info(
    {
      modelRouterEnabled,
      githubActionsDispatchEnabled,
      hasPat,
    },
    'SYNTARO Proxy module initializing',
  );

  if (!modelRouterEnabled) {
    log.warn('Model router is DISABLED — all model selections will use the default model');
  }

  if (!githubActionsDispatchEnabled) {
    log.warn('GitHub Actions dispatch is DISABLED — dispatch calls will be rejected');
  }

  if (githubActionsDispatchEnabled && !hasPat) {
    log.warn(
      'GitHub Actions dispatch is enabled but PROXY_GITHUB_PAT is not set — ' +
      'dispatch calls will fail until a PAT is configured',
    );
  }

  return {
    modelRouter,
    githubActionsDispatcher,
    rateLimiter,
    concurrencyManager,
    rateLimitMiddleware,
    initialized: true,
    meta: {
      modelRouterEnabled,
      githubActionsDispatchEnabled,
      hasPat,
      startedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton proxy instance
// ---------------------------------------------------------------------------

export const proxy: ProxyModule = initializeProxy();

// ── Re-exports for convenience ─────────────────────────────────────────────

export { ModelRouter } from './modelRouter.js';
export type {
  TaskComplexity,
  AccountTier,
  ModelOption,
  ModelSelectionParams,
  ModelSelectionResult,
} from './modelRouter.js';

export { GitHubActionsDispatcher } from './githubActionsDispatcher.js';
export type {
  DispatchWorkflowParams,
  DispatchWorkflowResult,
  DispatchStatus,
} from './githubActionsDispatcher.js';
