/**
 * Unit tests for agent type definitions (types.ts).
 *
 * Tests that each interface can be correctly constructed with valid field
 * values and that the discriminated union variants (fix_ready, no_fix,
 * investigation, error) are all properly representable.
 */

import { describe, expect, it } from 'vitest';
import type { AgentResult, AgentTool, FileChange, TestResult, TriageResult } from '../../agent/types.js';

// ── AgentTool ───────────────────────────────────────────────────────────────

describe('AgentTool interface', () => {
  it('can be constructed with all required fields', () => {
    const tool: AgentTool = {
      name: 'test_tool',
      description: 'A tool used for testing',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
        },
        required: ['file_path'],
      },
      handler: async (args) => `handled ${JSON.stringify(args)}`,
    };

    expect(tool.name).toBe('test_tool');
    expect(tool.description).toBe('A tool used for testing');
    expect(tool.inputSchema).toHaveProperty('type', 'object');
    expect(tool.inputSchema).toHaveProperty('properties');
    expect(typeof tool.handler).toBe('function');
  });

  it('handler returns a Promise<string>', async () => {
    const tool: AgentTool = {
      name: 'promise_test',
      description: 'Tests Promise return type',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => 'result',
    };

    const result = tool.handler({});
    // handler returns a Promise, so we await it
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe('result');
  });

  it('handler can accept arbitrary args', async () => {
    const tool: AgentTool = {
      name: 'echo',
      description: 'Echoes back the args',
      inputSchema: { type: 'object', properties: {} },
      handler: async (args) => JSON.stringify(args),
    };

    const result = await tool.handler({ key: 'value', num: 42 });
    expect(JSON.parse(result)).toEqual({ key: 'value', num: 42 });
  });

  it('name and description can vary freely', () => {
    const names = ['read_file', 'write_file', 'custom_tool', 'a', 'z'.repeat(100)];
    for (const name of names) {
      const tool: AgentTool = {
        name,
        description: `Tool: ${name}`,
        inputSchema: { type: 'object', properties: {} },
        handler: async () => '',
      };
      expect(tool.name).toBe(name);
    }
  });
});

// ── TestResult ──────────────────────────────────────────────────────────────

describe('TestResult interface', () => {
  it('can be constructed with all fields representing a passing run', () => {
    const result: TestResult = {
      passed: true,
      output: '✓ all tests passed (42 tests in 1.5s)',
      command: 'vitest run',
      durationMs: 1500,
    };

    expect(result.passed).toBe(true);
    expect(result.output).toContain('all tests passed');
    expect(result.command).toBe('vitest run');
    expect(result.durationMs).toBe(1500);
  });

  it('can represent a failing run', () => {
    const result: TestResult = {
      passed: false,
      output: 'FAIL tests/unit/foo.test.ts (5.2s)\n  ✗ should handle edge case',
      command: 'vitest run --reporter verbose',
      durationMs: 5200,
    };

    expect(result.passed).toBe(false);
    expect(result.output).toContain('FAIL');
  });

  it('durationMs can be 0 for instant failures', () => {
    const result: TestResult = {
      passed: false,
      output: 'Error: no tests found',
      command: 'vitest run',
      durationMs: 0,
    };
    expect(result.durationMs).toBe(0);
  });

  it('output can be empty string', () => {
    const result: TestResult = {
      passed: true,
      output: '',
      command: "echo 'no tests configured'",
      durationMs: 1,
    };
    expect(result.output).toBe('');
  });

  it('command can be empty (should not happen in practice but interface allows it)', () => {
    const result: TestResult = {
      passed: false,
      output: 'test crashed',
      command: '',
      durationMs: 100,
    };
    expect(result.command).toBe('');
  });
});

// ── TriageResult ────────────────────────────────────────────────────────────

describe('TriageResult interface', () => {
  it('can be constructed with all fields for a bug report', () => {
    const result: TriageResult = {
      type: 'bug',
      difficulty: 'medium',
      relevantFiles: ['src/login.ts', 'src/utils/validation.ts'],
      summary: 'Login handler does not escape special characters in password field',
    };

    expect(result.type).toBe('bug');
    expect(result.difficulty).toBe('medium');
    expect(result.relevantFiles).toHaveLength(2);
    expect(result.summary).toContain('Login handler');
  });

  it('supports all issue type variants', () => {
    const types = ['bug', 'feature', 'question', 'unknown'] as const;
    for (const type of types) {
      const result: TriageResult = {
        type,
        difficulty: 'easy',
        summary: `A ${type} ticket`,
      };
      expect(result.type).toBe(type);
    }
  });

  it('supports all difficulty variants', () => {
    const difficulties = ['easy', 'medium', 'hard', 'unknown'] as const;
    for (const difficulty of difficulties) {
      const result: TriageResult = {
        type: 'bug',
        difficulty,
        summary: `Difficulty: ${difficulty}`,
      };
      expect(result.difficulty).toBe(difficulty);
    }
  });

  it('relevantFiles is optional and defaults to undefined', () => {
    const result: TriageResult = {
      type: 'bug',
      difficulty: 'hard',
      summary: 'Core dump on startup',
    };

    expect(result.relevantFiles).toBeUndefined();
  });

  it('summary can be empty string (edge case)', () => {
    const result: TriageResult = {
      type: 'question',
      difficulty: 'unknown',
      summary: '',
    };
    expect(result.summary).toBe('');
  });

  it('all 16 combinations of type × difficulty are valid', () => {
    const types = ['bug', 'feature', 'question', 'unknown'] as const;
    const difficulties = ['easy', 'medium', 'hard', 'unknown'] as const;

    for (const type of types) {
      for (const difficulty of difficulties) {
        const result: TriageResult = { type, difficulty, summary: `${type}/${difficulty}` };
        expect(result.type).toBe(type);
        expect(result.difficulty).toBe(difficulty);
      }
    }
  });
});

// ── FileChange ──────────────────────────────────────────────────────────────

describe('FileChange interface', () => {
  it('can be constructed with all fields for a modification', () => {
    const change: FileChange = {
      path: 'src/login.ts',
      originalContent: 'const x = 1;',
      newContent: 'const x = 42;',
      action: 'modify',
    };

    expect(change.path).toBe('src/login.ts');
    expect(change.originalContent).toContain('const x =');
    expect(change.newContent).toContain('42');
    expect(change.action).toBe('modify');
  });

  it('supports all action types', () => {
    const actions = ['create', 'modify', 'delete'] as const;

    for (const action of actions) {
      const change: FileChange = {
        path: action === 'create' ? 'src/new.ts' : 'src/existing.ts',
        originalContent: action === 'create' ? '' : 'old content',
        newContent: action === 'delete' ? '' : 'new content',
        action,
      };
      expect(change.action).toBe(action);
    }
  });

  it('handles empty file contents (e.g., creating an empty file or deleting)', () => {
    const create: FileChange = {
      path: 'src/empty.ts',
      originalContent: '',
      newContent: '',
      action: 'create',
    };
    expect(create.originalContent).toBe('');
    expect(create.newContent).toBe('');

    const del: FileChange = {
      path: 'src/gone.ts',
      originalContent: 'old content',
      newContent: '',
      action: 'delete',
    };
    expect(del.newContent).toBe('');
  });

  it('path is a plain string (can be absolute or relative)', () => {
    const paths = ['src/file.ts', '/absolute/path/file.ts', 'relative/path/file.py', 'index.js'];
    for (const path of paths) {
      const change: FileChange = {
        path,
        originalContent: '',
        newContent: '',
        action: 'modify',
      };
      expect(change.path).toBe(path);
    }
  });
});

// ── AgentResult ─────────────────────────────────────────────────────────────

describe('AgentResult interface (fix_ready variant)', () => {
  it('can represent a high-confidence ready-to-submit fix', () => {
    const result: AgentResult = {
      summary: 'Fixed input sanitization in login handler. Added special character escaping.',
      confidence: 'high',
      fixReady: true,
      prUrl: 'https://github.com/owner/repo/pull/42',
      branchName: 'stas/fix-login-sanitization',
      diff: 'diff --git a/src/login.ts b/src/login.ts\n+  const sanitized = escapeSpecialChars(input);',
      testOutput: 'PASS tests/login.test.ts (42ms)\n  ✓ handles special characters\n\nTests: 1 passed, 1 total',
      errors: [],
    };

    expect(result.fixReady).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.prUrl).toBeDefined();
    expect(result.branchName).toContain('stas/');
    expect(result.diff).toContain('diff --git');
    expect(result.testOutput).toContain('PASS');
    expect(result.errors).toHaveLength(0);
  });
});

describe('AgentResult interface (no_fix variant)', () => {
  it('can represent a scenario where no fix is possible', () => {
    const result: AgentResult = {
      summary: 'Could not reproduce the issue. The login handler already handles special characters.',
      confidence: 'low',
      fixReady: false,
      noFixReason: 'Issue could not be reproduced on latest main branch.',
      alreadyFixed: true,
      errors: [],
    };

    expect(result.fixReady).toBe(false);
    expect(result.confidence).toBe('low');
    expect(result.noFixReason).toBeDefined();
    expect(result.noFixReason).toContain('reproduced');
    expect(result.alreadyFixed).toBe(true);
    expect(result.prUrl).toBeUndefined();
    expect(result.branchName).toBeUndefined();
  });

  it('noFixReason can explain known limitations', () => {
    const result: AgentResult = {
      summary: 'Third-party API limitation',
      confidence: 'medium',
      fixReady: false,
      noFixReason: 'The upstream API does not support batch operations. Filed upstream issue #123.',
      errors: [],
    };
    expect(result.noFixReason).toContain('upstream');
  });
});

describe('AgentResult interface (investigation-only variant)', () => {
  it('can represent an investigation result without a fix', () => {
    const result: AgentResult = {
      summary: 'Root cause identified: race condition in cache layer',
      confidence: 'medium',
      fixReady: false,
      investigationOnly: true,
      errors: [],
    };

    expect(result.fixReady).toBe(false);
    expect(result.investigationOnly).toBe(true);
    // fix-related fields should be absent
    expect(result.prUrl).toBeUndefined();
    expect(result.branchName).toBeUndefined();
    expect(result.diff).toBeUndefined();
  });
});

describe('AgentResult interface (error variant)', () => {
  it('can represent an error that occurred during processing', () => {
    const result: AgentResult = {
      summary: 'Failed to process issue #42',
      confidence: 'low',
      fixReady: false,
      errors: ['Connection timeout after 30s', 'Invalid response from GitHub API'],
    };

    expect(result.fixReady).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors![0]).toContain('timeout');
    expect(result.errors![1]).toContain('GitHub API');
  });

  it('errors array can be empty', () => {
    const result: AgentResult = {
      summary: 'All good',
      confidence: 'high',
      fixReady: true,
      errors: [],
    };
    expect(result.errors).toEqual([]);
  });
});

describe('AgentResult confidence field', () => {
  it('all three confidence levels are valid', () => {
    const levels = ['high', 'medium', 'low'] as const;

    for (const confidence of levels) {
      const result: AgentResult = {
        summary: 'Test',
        confidence,
        fixReady: false,
      };
      expect(result.confidence).toBe(confidence);
    }
  });
});

describe('AgentResult optional fields', () => {
  it('all optional fields can be omitted', () => {
    // The only required fields are: summary, confidence, fixReady
    const result: AgentResult = {
      summary: 'Minimal result',
      confidence: 'medium',
      fixReady: false,
    };

    expect(result.summary).toBe('Minimal result');
    expect(result.confidence).toBe('medium');
    expect(result.fixReady).toBe(false);

    // Optional fields should all be undefined
    expect(result.prUrl).toBeUndefined();
    expect(result.branchName).toBeUndefined();
    expect(result.diff).toBeUndefined();
    expect(result.testOutput).toBeUndefined();
    expect(result.errors).toBeUndefined();
    expect(result.relevantPRs).toBeUndefined();
    expect(result.noFixReason).toBeUndefined();
    expect(result.alreadyFixed).toBeUndefined();
    expect(result.investigationOnly).toBeUndefined();
  });

  it('relevantPRs can be populated', () => {
    const result: AgentResult = {
      summary: 'Found related PRs',
      confidence: 'medium',
      fixReady: false,
      relevantPRs: [
        { url: 'https://github.com/owner/repo/pull/1', title: 'Fix login', state: 'merged' },
        { url: 'https://github.com/owner/repo/pull/2', title: 'Add tests', state: 'open' },
      ],
    };

    expect(result.relevantPRs).toHaveLength(2);
    expect(result.relevantPRs![0].title).toBe('Fix login');
    expect(result.relevantPRs![1].state).toBe('open');
  });

  it('can combine fix_ready with optional metadata', () => {
    const result: AgentResult = {
      summary: 'Fixed everything',
      confidence: 'high',
      fixReady: true,
      prUrl: 'https://github.com/owner/repo/pull/100',
      branchName: 'stas/ultimate-fix',
      diff: "diff --git a/src/main.ts b/src/main.ts\n+console.log('fixed')",
      testOutput: 'PASS',
      errors: [],
      relevantPRs: [{ url: 'https://github.com/owner/repo/pull/99', title: 'Previous fix', state: 'merged' }],
    };

    expect(result.prUrl).toContain('pull/100');
    expect(result.relevantPRs![0].state).toBe('merged');
    expect(result.errors).toEqual([]);
  });
});
