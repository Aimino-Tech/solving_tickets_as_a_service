/**
 * MockResponseProvider — deterministic placeholder responses for AI-disabled mode.
 *
 * When STAS_AI_MODE=static, all AI agent calls return pre-defined static data
 * instead of hitting real AI APIs. This allows testing the full application
 * flow (webhooks → queue → dispatch → PR creation) without burning tokens.
 *
 * ── Usage ──────────────────────────────────────────────────────────────
 *   import { mockResponses } from './mockResponses.js';
 *   const result = mockResponses.dispatchToOpenCode();
 *   // → { success: true, summary: "[STATIC MODE] ...", confidence: "medium", ... }
 * ────────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'mock-responses' });

/**
 * Deterministic mock response class.
 * All methods return fixed placeholder data with no randomness.
 */
class MockResponseProvider {
  /** Counter to make repeated calls slightly distinguishable for debugging. */
  private callCount = 0;
  /** Runtime override for AI mode (takes precedence over config.aiMode). */
  private runtimeAiModeOverride: 'ai' | 'static' | null = null;

  /**
   * Check whether static mode is active.
   * Runtime override takes precedence over env-based config.
   */
  isStaticMode(): boolean {
    if (this.runtimeAiModeOverride !== null) {
      return this.runtimeAiModeOverride === 'static';
    }
    return config.stas.aiMode === 'static';
  }

  /**
   * Override AI mode at runtime (no restart needed).
   * Pass null to revert to env-based config value.
   */
  setMode(mode: 'ai' | 'static' | null): void {
    this.runtimeAiModeOverride = mode;
    log.info({ mode: mode ?? 'config-default' }, 'Runtime AI mode override set');
  }

  /**
   * Get the current effective AI mode.
   */
  getEffectiveMode(): 'ai' | 'static' {
    return this.isStaticMode() ? 'static' : 'ai';
  }

  /**
   * Reset call counter (for testing).
   */
  resetCount(): void {
    this.callCount = 0;
  }

  /**
   * Mock the OpenCode agent dispatch response.
   * Returns a valid OpenCodeDispatchResult with static placeholder data.
   */
  dispatchToOpenCode(): {
    success: boolean;
    summary: string;
    confidence: 'high' | 'medium' | 'low';
    branchName?: string;
    diff?: string;
    testOutput?: string;
    errors?: string[];
    metadata?: Record<string, unknown>;
  } {
    this.callCount++;
    log.info({ callCount: this.callCount }, '[STATIC MODE] Returning mock OpenCode dispatch response');

    return {
      success: true,
      summary: `[STATIC MODE] Mock agent run #${this.callCount}. In static mode, AI agent is disabled. No actual fix was attempted.`,
      confidence: 'medium',
      branchName: `stas/static-test-branch-${this.callCount}`,
      diff: `diff --git a/README.md b/README.md\nindex abc..def 100644\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-This is a static placeholder diff\n+[STATIC MODE] No changes were made`,
      testOutput: `[STATIC MODE] Test run skipped — AI agent is disabled.\nTests: 0 passed, 0 failed, 0 skipped.`,
      errors: [],
      metadata: {
        staticMode: true,
        callCount: this.callCount,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Mock the triage/classification response.
   */
  triageResult(): {
    type: 'bug' | 'feature' | 'question' | 'unknown';
    difficulty: 'easy' | 'medium' | 'hard' | 'unknown';
    summary: string;
    relevantFiles?: string[];
  } {
    this.callCount++;
    return {
      type: 'bug',
      difficulty: 'medium',
      summary: `[STATIC MODE] Mock classification #${this.callCount}. Issue auto-classified as bug with medium difficulty.`,
      relevantFiles: ['src/index.ts', 'src/config.ts'],
    };
  }

  /**
   * Mock OpenCode health check status.
   */
  healthStatus(): {
    status: string;
    circuit: string;
    consecutiveFailures: number;
    lastChecked: string;
  } {
    return {
      status: 'static_mode',
      circuit: 'closed',
      consecutiveFailures: 0,
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * Mock sandbox test run result.
   */
  testRun(): {
    passed: boolean;
    output: string;
    command: string;
    durationMs: number;
  } {
    return {
      passed: true,
      output: `[STATIC MODE] All tests skipped — mock mode.\n0 test files found. 0 tests total.`,
      command: 'npm test',
      durationMs: 42,
    };
  }

  /**
   * Mock verification result.
   */
  verificationResult(): {
    baseline: unknown;
    postFix: unknown;
    regressionTestCreated: boolean;
    regressionTestPassedOnOriginal: boolean | null;
    regressionTestPassedOnFix: boolean | null;
    preExistingTestsRegressed: boolean;
    unverified: boolean;
    details: string[];
    qualityGates: Array<{ gate: string; passed: boolean; tool?: string }>;
  } {
    return {
      baseline: null,
      postFix: null,
      regressionTestCreated: false,
      regressionTestPassedOnOriginal: null,
      regressionTestPassedOnFix: null,
      preExistingTestsRegressed: false,
      unverified: true,
      details: ['[STATIC MODE] Verification skipped — AI agent disabled'],
      qualityGates: [
        { gate: 'reality-check', passed: true, tool: 'fs.stat' },
        { gate: 'compile-check', passed: true, tool: 'tsc' },
        { gate: 'test-integrity', passed: true, tool: 'vitest' },
        { gate: 'hallucination-scan', passed: true, tool: 'anti-hallucination' },
        { gate: 'dead-code-check', passed: true, tool: 'knip' },
      ],
    };
  }
}

/** Singleton instance for use across the application. */
export const mockResponses = new MockResponseProvider();
