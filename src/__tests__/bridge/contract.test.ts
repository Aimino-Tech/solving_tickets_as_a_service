/**
 * Unit tests for src/bridge/contract.ts — OpenCode contract validation.
 */

import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  OpenCodeContract,
  OpenCodeRequestSchema,
  OpenCodeResponseSchema,
  validateOpenCodeRequest,
  validateOpenCodeResponse,
} from '../../bridge/contract.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validRequest = {
  prompt: `# STAS Fix Agent\n\nYou are an autonomous fix agent for owner/repo.\nYour task is to fix issue #42.`,
  model: 'anthropic/claude-sonnet-4-20250514',
};

const validResponse = {
  summary: 'Fixed the login validation bug by adding email sanitization.',
  confidence: 'high',
  diff: 'diff --git a/src/auth/login.ts b/src/auth/login.ts\nindex abc..def 100644\n--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n@@ -10,5 +10,8 @@\n+const sanitized = sanitizeEmail(email);',
  branch: 'stas/fix-42-a1b2c3d',
  testOutput: 'PASS tests/auth/login.test.ts (12ms)\nTests: 2 passed, 2 total',
  errors: [],
};

// ---------------------------------------------------------------------------
// Contract Version
// ---------------------------------------------------------------------------

describe('OpenCodeContract', () => {
  describe('VERSION', () => {
    it('has a valid semver version string', () => {
      expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      expect(OpenCodeContract.VERSION).toBe(CONTRACT_VERSION);
    });
  });

  // -----------------------------------------------------------------------
  // Request Validation
  // -----------------------------------------------------------------------

  describe('validateRequest', () => {
    it('accepts a valid request', () => {
      const result = OpenCodeContract.validateRequest(validRequest);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.prompt).toBe(validRequest.prompt);
      expect(result.data!.model).toBe(validRequest.model);
      expect(result.errors).toBeUndefined();
    });

    it('rejects a request with empty prompt', () => {
      const result = OpenCodeContract.validateRequest({
        prompt: '',
        model: 'gpt-4o',
      });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0]).toContain('prompt');
    });

    it('rejects a request with missing prompt', () => {
      const result = OpenCodeContract.validateRequest({
        model: 'gpt-4o',
      });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('rejects a request with empty model', () => {
      const result = OpenCodeContract.validateRequest({
        prompt: 'Do something',
        model: '',
      });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('model');
    });

    it('rejects a request with missing model', () => {
      const result = OpenCodeContract.validateRequest({
        prompt: 'Do something',
      });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('rejects a request with malformed model name', () => {
      const result = OpenCodeContract.validateRequest({
        prompt: 'Do something',
        model: 'invalid model name!',
      });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('model');
    });

    it('accepts various valid model formats', () => {
      const validModels = [
        'gpt-4o',
        'anthropic/claude-sonnet-4-20250514',
        'deepseek-v4-flash',
        'openai/gpt-4-turbo',
        'google/gemini-2.0-flash-001',
      ];

      for (const model of validModels) {
        const result = OpenCodeContract.validateRequest({
          prompt: 'Do something',
          model,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects a request with prompt exceeding max length', () => {
      const longPrompt = 'x'.repeat(100_001);
      const result = OpenCodeContract.validateRequest({
        prompt: longPrompt,
        model: 'gpt-4o',
      });
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('prompt');
    });

    it('rejects null input', () => {
      const result = OpenCodeContract.validateRequest(null);
      expect(result.success).toBe(false);
    });

    it('rejects non-object input', () => {
      const result = OpenCodeContract.validateRequest('not-an-object');
      expect(result.success).toBe(false);
    });

    it('rejects array input', () => {
      const result = OpenCodeContract.validateRequest(['prompt', 'model']);
      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Response Validation
  // -----------------------------------------------------------------------

  describe('validateResponse', () => {
    it('accepts a valid full response', () => {
      const result = OpenCodeContract.validateResponse(validResponse);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.summary).toBe(validResponse.summary);
      expect(result.data!.confidence).toBe('high');
      expect(result.data!.diff).toBe(validResponse.diff);
      expect(result.data!.branch).toBe('stas/fix-42-a1b2c3d');
      expect(result.data!.testOutput).toBe(validResponse.testOutput);
      expect(result.data!.errors).toEqual([]);
      expect(result.errors).toBeUndefined();
    });

    it('accepts a minimal valid response (only summary and confidence)', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'Completed analysis.',
        confidence: 'medium',
      });
      expect(result.success).toBe(true);
      expect(result.data!.summary).toBe('Completed analysis.');
      expect(result.data!.confidence).toBe('medium');
      expect(result.data!.diff).toBeUndefined();
      expect(result.data!.branch).toBeUndefined();
      expect(result.data!.errors).toBeUndefined();
    });

    it('accepts a failure response with errors', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'Unable to fix the issue.',
        confidence: 'low',
        errors: ['Could not find root cause', 'File not found'],
      });
      expect(result.success).toBe(true);
      expect(result.data!.errors).toHaveLength(2);
    });

    it('accepts a response with metadata', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'Fix applied.',
        confidence: 'high',
        metadata: {
          filesChanged: 3,
          durationMs: 45000,
          model: 'claude-sonnet-4',
        },
      });
      expect(result.success).toBe(true);
      expect(result.data!.metadata).toBeDefined();
      expect(result.data!.metadata!.filesChanged).toBe(3);
    });

    it('rejects a response with empty summary', () => {
      const result = OpenCodeContract.validateResponse({
        summary: '',
        confidence: 'high',
      });
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('summary');
    });

    it('rejects a response with missing summary', () => {
      const result = OpenCodeContract.validateResponse({
        confidence: 'high',
      });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('rejects a response with invalid confidence value', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'Fix applied.',
        confidence: 'ultra',
      });
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('confidence');
    });

    it('rejects a response with missing confidence', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'Fix applied.',
      });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('rejects a response with malformed branch name', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'Fix applied.',
        confidence: 'high',
        branch: 'invalid-branch-name',
      });
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('branch');
    });

    it('accepts valid branch name formats', () => {
      const validBranches = [
        'stas/fix-42-a1b2c3d',
        'stas/fix-123-abc123',
        'stas/fix-0-deadbeef',
      ];

      for (const branch of validBranches) {
        const result = OpenCodeContract.validateResponse({
          summary: 'Fix applied.',
          confidence: 'high',
          branch,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid branch name formats', () => {
      const invalidBranches = [
        'stas/fix-abcd-1234',       // non-numeric issue number
        'fix-42-a1b2c3d',           // missing stas/ prefix
        'stas/fix-42-',             // missing hash
        'stas/fix-42',              // missing hash
        'stas-feat-42-a1b2c3d',     // wrong prefix
        '/stas/fix-42-a1b2c3d',     // leading slash
      ];

      for (const branch of invalidBranches) {
        const result = OpenCodeContract.validateResponse({
          summary: 'Fix applied.',
          confidence: 'high',
          branch,
        });
        expect(result.success).toBe(false);
      }
    });

    it('rejects a response with non-array errors', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'Fix applied.',
        confidence: 'high',
        errors: 'not-an-array',
      });
      expect(result.success).toBe(false);
    });

    it('rejects null input', () => {
      const result = OpenCodeContract.validateResponse(null);
      expect(result.success).toBe(false);
    });

    it('rejects non-object input', () => {
      const result = OpenCodeContract.validateResponse('plain-string');
      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Zod Schema Direct Usage
  // -----------------------------------------------------------------------

  describe('Zod schemas', () => {
    it('OpenCodeRequestSchema parses valid input', () => {
      const parsed = OpenCodeRequestSchema.safeParse(validRequest);
      expect(parsed.success).toBe(true);
    });

    it('OpenCodeRequestSchema rejects empty prompt', () => {
      const parsed = OpenCodeRequestSchema.safeParse({
        prompt: '',
        model: 'gpt-4o',
      });
      expect(parsed.success).toBe(false);
    });

    it('OpenCodeRequestSchema rejects model without slash', () => {
      const parsed = OpenCodeRequestSchema.safeParse({
        prompt: 'Do something',
        model: 'invalid@model',
      });
      expect(parsed.success).toBe(false);
    });

    it('OpenCodeResponseSchema parses valid full response', () => {
      const parsed = OpenCodeResponseSchema.safeParse(validResponse);
      expect(parsed.success).toBe(true);
    });

    it('OpenCodeResponseSchema parses minimal valid response', () => {
      const parsed = OpenCodeResponseSchema.safeParse({
        summary: 'Done',
        confidence: 'low',
      });
      expect(parsed.success).toBe(true);
    });

    it('OpenCodeResponseSchema rejects missing required fields', () => {
      const parsed = OpenCodeResponseSchema.safeParse({});
      expect(parsed.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Static class vs function equivalence
  // -----------------------------------------------------------------------

  describe('function and class method equivalence', () => {
    it('validateOpenCodeRequest and OpenCodeContract.validateRequest return same result', () => {
      const fnResult = validateOpenCodeRequest(validRequest);
      const classResult = OpenCodeContract.validateRequest(validRequest);
      expect(fnResult.success).toBe(classResult.success);
      expect(fnResult.data).toEqual(classResult.data);
    });

    it('validateOpenCodeResponse and OpenCodeContract.validateResponse return same result', () => {
      const fnResult = validateOpenCodeResponse(validResponse);
      const classResult = OpenCodeContract.validateResponse(validResponse);
      expect(fnResult.success).toBe(classResult.success);
      expect(fnResult.data).toEqual(classResult.data);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles summary at exactly max length', () => {
      const summary = 'a'.repeat(10_000);
      const result = OpenCodeContract.validateResponse({
        summary,
        confidence: 'medium',
      });
      expect(result.success).toBe(true);
    });

    it('rejects summary exceeding max length', () => {
      const summary = 'a'.repeat(10_001);
      const result = OpenCodeContract.validateResponse({
        summary,
        confidence: 'medium',
      });
      expect(result.success).toBe(false);
    });

    it('handles prompt at exactly max length', () => {
      const prompt = 'a'.repeat(100_000);
      const result = OpenCodeContract.validateRequest({
        prompt,
        model: 'gpt-4o',
      });
      expect(result.success).toBe(true);
    });

    it('handles empty errors array', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'All good.',
        confidence: 'high',
        errors: [],
      });
      expect(result.success).toBe(true);
      expect(result.data!.errors).toEqual([]);
    });

    it('handles empty metadata object', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'All good.',
        confidence: 'high',
        metadata: {},
      });
      expect(result.success).toBe(true);
      expect(result.data!.metadata).toEqual({});
    });

    it('handles undefined optional fields', () => {
      const result = OpenCodeContract.validateResponse({
        summary: 'All good.',
        confidence: 'high',
        diff: undefined,
        branch: undefined,
        testOutput: undefined,
        errors: undefined,
        metadata: undefined,
      });
      expect(result.success).toBe(true);
    });
  });
});
