/**
 * Tests for the OpenCode contract — types, Zod schemas, and helpers.
 *
 * Strategy:
 *   The module is pure (no side-effects, no I/O), so no mocking is needed.
 *   We test serialization round-trips, Zod validation (valid & invalid payloads),
 *   and the helper parse functions.
 *
 * Coverage:
 *   - OpenCodeDispatchRequest schema (valid / invalid)
 *   - OpenCodeDispatchResponse schema (valid / invalid)
 *   - OpenCodeProgress schema (valid / invalid)
 *   - OpenCodeResult schema (valid / invalid)
 *   - ModelChainConfig schema
 *   - Confidence level validation
 *   - Helper function round-trips
 */

import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_LEVELS,
  OPENCODE_RUN_ENDPOINT,
  confidenceLevelSchema,
  modelChainConfigSchema,
  openCodeDispatchRequestSchema,
  openCodeDispatchResponseSchema,
  openCodeProgressSchema,
  openCodeResultSchema,
  parseConfidence,
  parseDispatchRequest,
  parseDispatchResponse,
  parseResult,
  safeParseDispatchRequest,
  safeParseDispatchResponse,
  safeParseResult,
} from '../opencode-contract.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('OPENCODE_RUN_ENDPOINT is /api/run', () => {
    expect(OPENCODE_RUN_ENDPOINT).toBe('/api/run');
  });

  it('CONFIDENCE_LEVELS has exactly high, medium, low', () => {
    expect(CONFIDENCE_LEVELS).toEqual(['high', 'medium', 'low']);
  });
});

// ---------------------------------------------------------------------------
// Confidence level
// ---------------------------------------------------------------------------

describe('confidenceLevelSchema', () => {
  it.each(['high', 'medium', 'low'])('accepts valid confidence: %s', (level) => {
    expect(confidenceLevelSchema.parse(level)).toBe(level);
  });

  it.each(['unknown', 'very-high', '', 0, null, undefined])('rejects invalid confidence: %s', (val) => {
    expect(() => confidenceLevelSchema.parse(val)).toThrow();
  });
});

describe('parseConfidence', () => {
  it('returns the parsed confidence level', () => {
    expect(parseConfidence('high')).toBe('high');
  });

  it('throws on invalid input', () => {
    expect(() => parseConfidence('unknown')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OpenCodeDispatchRequest
// ---------------------------------------------------------------------------

describe('openCodeDispatchRequestSchema', () => {
  const validRequest = {
    prompt: 'You are a fix agent. Please fix the bug.',
    model: 'anthropic/claude-sonnet-4-20250514',
  };

  it('accepts a valid dispatch request', () => {
    const result = openCodeDispatchRequestSchema.parse(validRequest);
    expect(result).toEqual(validRequest);
  });

  it('rejects an empty prompt', () => {
    expect(() =>
      openCodeDispatchRequestSchema.parse({ ...validRequest, prompt: '' }),
    ).toThrow();
  });

  it('rejects an empty model', () => {
    expect(() =>
      openCodeDispatchRequestSchema.parse({ ...validRequest, model: '' }),
    ).toThrow();
  });

  it('rejects a prompt that is too long (>100k chars)', () => {
    expect(() =>
      openCodeDispatchRequestSchema.parse({
        ...validRequest,
        prompt: 'x'.repeat(100_001),
      }),
    ).toThrow();
  });

  it('rejects a model that is too long (>200 chars)', () => {
    expect(() =>
      openCodeDispatchRequestSchema.parse({
        ...validRequest,
        model: 'm'.repeat(201),
      }),
    ).toThrow();
  });

  it('rejects extra unknown properties via .strict()', () => {
    expect(() =>
      openCodeDispatchRequestSchema.parse({
        ...validRequest,
        extraField: 'not-allowed',
      }),
    ).toThrow();
  });

  it('rejects missing prompt', () => {
    const { prompt: _, ...rest } = validRequest;
    expect(() => openCodeDispatchRequestSchema.parse(rest)).toThrow();
  });

  it('rejects missing model', () => {
    const { model: _, ...rest } = validRequest;
    expect(() => openCodeDispatchRequestSchema.parse(rest)).toThrow();
  });

  it('rejects non-string types', () => {
    expect(() =>
      openCodeDispatchRequestSchema.parse({ prompt: 123, model: true }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OpenCodeDispatchResponse
// ---------------------------------------------------------------------------

describe('openCodeDispatchResponseSchema', () => {
  const validResponse = {
    summary: 'Fixed the login validation bug.',
    confidence: 'high' as const,
    diff: '--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1,3 +1,4 @@',
    branch: 'stas/fix-42-a1b2c3d',
    testOutput: 'PASS  tests/login.test.ts\n  ✓ validates email (12ms)',
    errors: ['minor: lint warning on line 45'],
    metadata: { durationMs: 45_000 },
  };

  it('accepts a full valid response', () => {
    const result = openCodeDispatchResponseSchema.parse(validResponse);
    expect(result).toEqual(validResponse);
  });

  it('accepts a minimal valid response (only required fields)', () => {
    const minimal = { summary: 'Done.', confidence: 'medium' as const };
    const result = openCodeDispatchResponseSchema.parse(minimal);
    expect(result).toEqual(minimal);
  });

  it('rejects missing summary', () => {
    const { summary: _, ...rest } = validResponse;
    expect(() => openCodeDispatchResponseSchema.parse(rest)).toThrow();
  });

  it('rejects missing confidence', () => {
    const { confidence: _, ...rest } = validResponse;
    expect(() => openCodeDispatchResponseSchema.parse(rest)).toThrow();
  });

  it('rejects invalid confidence value', () => {
    expect(() =>
      openCodeDispatchResponseSchema.parse({
        summary: 'Done.',
        confidence: 'super-high',
      }),
    ).toThrow();
  });

  it('rejects extra unknown properties via .strict()', () => {
    expect(() =>
      openCodeDispatchResponseSchema.parse({
        ...validResponse,
        secretField: 'leak',
      }),
    ).toThrow();
  });

  it('rejects non-string errors array', () => {
    expect(() =>
      openCodeDispatchResponseSchema.parse({
        summary: 'Done.',
        confidence: 'low',
        errors: [123, 456] as unknown as string[],
      }),
    ).toThrow();
  });

  it('accepts response with no optional fields', () => {
    const result = openCodeDispatchResponseSchema.parse({
      summary: 'Fixed.',
      confidence: 'high',
    });
    expect(result.diff).toBeUndefined();
    expect(result.branch).toBeUndefined();
    expect(result.testOutput).toBeUndefined();
    expect(result.errors).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OpenCodeProgress
// ---------------------------------------------------------------------------

describe('openCodeProgressSchema', () => {
  const validProgress = {
    runId: 'run_abc123',
    phase: 'fixing' as const,
    message: 'Implementing the fix for login validation',
    progress: 60,
    detail: 'Modifying src/login.ts',
    timestamp: '2025-06-24T10:30:00.000Z',
  };

  it('accepts a valid progress update', () => {
    expect(openCodeProgressSchema.parse(validProgress)).toEqual(validProgress);
  });

  it('accepts progress without optional fields', () => {
    const minimal = {
      runId: 'run_abc123',
      phase: 'investigating' as const,
      message: 'Tracing the code path',
      timestamp: '2025-06-24T10:30:00.000Z',
    };
    expect(openCodeProgressSchema.parse(minimal)).toEqual(minimal);
  });

  it.each([
    'cloning',
    'investigating',
    'fixing',
    'testing',
    'verifying',
    'committing',
    'done',
    'error',
  ] as const)('accepts valid phase: %s', (phase) => {
    expect(
      openCodeProgressSchema.parse({
        runId: 'run_x',
        phase,
        message: 'phase',
        timestamp: '2025-06-24T10:30:00.000Z',
      }).phase,
    ).toBe(phase);
  });

  it('rejects invalid phase', () => {
    expect(() =>
      openCodeProgressSchema.parse({
        runId: 'run_x',
        phase: 'unknown-phase',
        message: 'bad',
        timestamp: '2025-06-24T10:30:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects progress out of range (>100)', () => {
    expect(() =>
      openCodeProgressSchema.parse({
        runId: 'run_x',
        phase: 'fixing',
        message: 'over',
        progress: 150,
        timestamp: '2025-06-24T10:30:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects missing runId', () => {
    const { runId: _, ...rest } = validProgress;
    expect(() => openCodeProgressSchema.parse(rest)).toThrow();
  });

  it('rejects missing timestamp', () => {
    const { timestamp: _, ...rest } = validProgress;
    expect(() => openCodeProgressSchema.parse(rest)).toThrow();
  });

  it('rejects extra unknown properties via .strict()', () => {
    expect(() =>
      openCodeProgressSchema.parse({
        ...validProgress,
        surprise: 'field',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OpenCodeResult
// ---------------------------------------------------------------------------

describe('openCodeResultSchema', () => {
  const validResult = {
    success: true,
    summary: 'Fixed the issue',
    confidence: 'high' as const,
    branchName: 'stas/fix-42-a1b2c3',
    diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@',
    testOutput: 'PASS 1 test',
    errors: ['minor warning'],
    metadata: { durationMs: 30_000 },
  };

  it('accepts a successful result', () => {
    expect(openCodeResultSchema.parse(validResult)).toEqual(validResult);
  });

  it('accepts a minimal failure result', () => {
    const failure = {
      success: false,
      summary: 'Agent failed on all models',
      confidence: 'low' as const,
      errors: ['timeout'],
    };
    expect(openCodeResultSchema.parse(failure)).toEqual(failure);
  });

  it('rejects missing success flag', () => {
    const { success: _, ...rest } = validResult;
    expect(() => openCodeResultSchema.parse(rest)).toThrow();
  });

  it('rejects invalid confidence', () => {
    expect(() =>
      openCodeResultSchema.parse({
        success: true,
        summary: 'Done',
        confidence: 'unknown',
      }),
    ).toThrow();
  });

  it('rejects extra unknown properties via .strict()', () => {
    expect(() =>
      openCodeResultSchema.parse({
        ...validResult,
        extra: 'not-allowed',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ModelChainConfig
// ---------------------------------------------------------------------------

describe('modelChainConfigSchema', () => {
  it('accepts a valid config with fallbacks', () => {
    const config = {
      primary: 'anthropic/claude-sonnet-4-20250514',
      fallbacks: ['gpt-4o', 'claude-haiku'],
    };
    expect(modelChainConfigSchema.parse(config)).toEqual(config);
  });

  it('requires fallbacks to be present', () => {
    const config = { primary: 'gpt-4o', fallbacks: [] };
    expect(modelChainConfigSchema.parse(config)).toEqual({
      primary: 'gpt-4o',
      fallbacks: [],
    });
  });

  it('rejects empty primary model', () => {
    expect(() =>
      modelChainConfigSchema.parse({ primary: '', fallbacks: [] }),
    ).toThrow();
  });

  it('rejects extra unknown properties via .strict()', () => {
    expect(() =>
      modelChainConfigSchema.parse({
        primary: 'gpt-4o',
        fallbacks: [],
        extra: 'nope',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('parseDispatchRequest', () => {
  it('parses valid input', () => {
    const result = parseDispatchRequest({
      prompt: 'Fix the bug',
      model: 'claude-sonnet',
    });
    expect(result.prompt).toBe('Fix the bug');
    expect(result.model).toBe('claude-sonnet');
  });

  it('throws on invalid input', () => {
    expect(() => parseDispatchRequest({})).toThrow();
  });
});

describe('safeParseDispatchRequest', () => {
  it('returns success for valid input', () => {
    const result = safeParseDispatchRequest({
      prompt: 'fix',
      model: 'gpt-4o',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toBe('fix');
    }
  });

  it('returns failure for invalid input', () => {
    const result = safeParseDispatchRequest({});
    expect(result.success).toBe(false);
  });
});

describe('parseDispatchResponse', () => {
  it('parses valid input', () => {
    const result = parseDispatchResponse({
      summary: 'Done',
      confidence: 'medium',
    });
    expect(result.summary).toBe('Done');
  });

  it('throws on invalid input', () => {
    expect(() => parseDispatchResponse({})).toThrow();
  });
});

describe('safeParseDispatchResponse', () => {
  it('returns success for valid input', () => {
    const result = safeParseDispatchResponse({
      summary: 'done',
      confidence: 'low',
    });
    expect(result.success).toBe(true);
  });

  it('returns failure for invalid input', () => {
    const result = safeParseDispatchResponse({});
    expect(result.success).toBe(false);
  });
});

describe('parseResult', () => {
  it('parses valid input', () => {
    const result = parseResult({
      success: true,
      summary: 'fixed',
      confidence: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('throws on invalid input', () => {
    expect(() => parseResult({ success: true })).toThrow();
  });
});

describe('safeParseResult', () => {
  it('returns success for valid input', () => {
    const result = safeParseResult({
      success: false,
      summary: 'failed',
      confidence: 'low',
    });
    expect(result.success).toBe(true);
  });

  it('returns failure for invalid input', () => {
    const result = safeParseResult({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: serialize → JSON → parse
// ---------------------------------------------------------------------------

describe('serialization round-trips', () => {
  it('OpenCodeDispatchRequest survives JSON round-trip', () => {
    const original = {
      prompt: 'Fix the login bug in the auth module.',
      model: 'anthropic/claude-sonnet-4-20250514',
    };
    const json = JSON.stringify(original);
    const parsed = openCodeDispatchRequestSchema.parse(JSON.parse(json));
    expect(parsed).toEqual(original);
  });

  it('OpenCodeDispatchResponse survives JSON round-trip', () => {
    const original = {
      summary: 'Fixed the login validation.',
      confidence: 'high' as const,
      diff: '--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1,3 +1,4 @@\n+console.log("fixed");',
      branch: 'stas/fix-42',
      testOutput: 'PASS (1 test)',
      errors: [],
      metadata: { durationMs: 120_000 },
    };
    const json = JSON.stringify(original);
    const parsed = openCodeDispatchResponseSchema.parse(JSON.parse(json));
    expect(parsed).toEqual(original);
  });

  it('OpenCodeResult survives JSON round-trip', () => {
    const original = {
      success: true,
      summary: 'Fixed the issue',
      confidence: 'high' as const,
      branchName: 'stas/fix-42',
      diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
      testOutput: 'PASS',
      errors: undefined,
    };
    const json = JSON.stringify(original);
    const parsed = openCodeResultSchema.parse(JSON.parse(json));
    expect(parsed).toEqual(original);
  });

  it('all confidence levels survive round-trip', () => {
    for (const level of CONFIDENCE_LEVELS) {
      const parsed = parseConfidence(level);
      expect(parsed).toBe(level);
    }
  });
});
