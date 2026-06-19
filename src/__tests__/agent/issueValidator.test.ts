import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractFileReferences, checkFilesExist, validateIssue } from '../../agent/issueValidator.js';
import type { SandboxExecutor } from '../../sandbox/types.js';

function mockSandbox(execResults: Record<string, { stdout: string; stderr: string; exitCode: number }>): SandboxExecutor {
  return {
    boot: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockImplementation(async (cmd: string) => {
      const key = Object.keys(execResults).find((k) => cmd.includes(k));
      const result = key ? execResults[key] : execResults['__default__'];
      return result ?? { stdout: '', stderr: '', exitCode: 0 };
    }),
    execForTools: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    removeFile: vi.fn().mockResolvedValue(undefined),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    hasTestSuite: vi.fn().mockReturnValue(true),
    runTests: vi.fn().mockResolvedValue({ passed: true, output: '', command: '', durationMs: 0 }),
    runSpecificTest: vi.fn().mockResolvedValue({ passed: true, output: '', command: '', durationMs: 0 }),
    formatCode: vi.fn().mockResolvedValue(undefined),
    analyzeCode: vi.fn().mockResolvedValue(''),
    detectRuntime: vi.fn().mockResolvedValue({ language: '', version: '', testCommand: '', installCommand: '', formatCommand: '', lintCommand: '' }),
    installDeps: vi.fn().mockResolvedValue(undefined),
  } as SandboxExecutor;
}

describe('extractFileReferences', () => {
  it('extracts backtick-quoted src/ file paths', () => {
    const refs = extractFileReferences('Fix bug in `src/utils.ts`', '');
    expect(refs).toEqual(['src/utils.ts']);
  });

  it('extracts multiple file paths from title and body', () => {
    const refs = extractFileReferences('Multiple files', 'Found in `src/foo.ts` and `src/bar/calc.py`');
    expect(refs).toEqual(['src/bar/calc.py', 'src/foo.ts']);
  });

  it('deduplicates repeated file references', () => {
    const refs = extractFileReferences('Check `src/utils.ts`', 'And again `src/utils.ts`');
    expect(refs).toEqual(['src/utils.ts']);
  });

  it('extracts paths with various extensions', () => {
    const refs = extractFileReferences(
      '',
      'Files: `src/a.ts`, `src/b.js`, `src/c.py`, `src/d.go`, `src/e.rs`, `src/f.rb`',
    );
    expect(refs).toEqual([
      'src/a.ts',
      'src/b.js',
      'src/c.py',
      'src/d.go',
      'src/e.rs',
      'src/f.rb',
    ]);
  });

  it('ignores paths with non-standard extensions', () => {
    const refs = extractFileReferences('Check `somefile.xyz`', '');
    expect(refs).toEqual([]);
  });

  it('extracts lib/ and app/ and packages/ paths', () => {
    const refs = extractFileReferences(
      '',
      'Paths: `lib/core.ts`, `app/controller.js`, `packages/shared/utils.py`',
    );
    expect(refs).toEqual(['app/controller.js', 'lib/core.ts', 'packages/shared/utils.py']);
  });

  it('ignores URL-like references', () => {
    const refs = extractFileReferences('See `https://example.com/file.ts`', '');
    expect(refs).toEqual([]);
  });

  it('returns empty array for empty inputs', () => {
    expect(extractFileReferences('', '')).toEqual([]);
    expect(extractFileReferences('no paths here', 'just some text')).toEqual([]);
  });

  it('returns sorted results', () => {
    const refs = extractFileReferences('', '`src/z.ts`, `src/a.ts`, `src/m.ts`');
    expect(refs).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('handles unicode and special characters in title', () => {
    const refs = extractFileReferences('Fix 🔧 `src/calc.ts`', '테스트 문제: `src/utils.ts`');
    expect(refs).toEqual(['src/calc.ts', 'src/utils.ts']);
  });
});

describe('checkFilesExist', () => {
  it('returns true for existing files', async () => {
    const sandbox = mockSandbox({
      'test -f': { stdout: 'EXISTS', stderr: '', exitCode: 0 },
    });
    const result = await checkFilesExist(sandbox, ['src/utils.ts']);
    expect(result).toEqual([true]);
  });

  it('returns false for missing files', async () => {
    const sandbox = mockSandbox({
      'test -f': { stdout: 'MISSING', stderr: '', exitCode: 1 },
    });
    const result = await checkFilesExist(sandbox, ['src/nonexistent.ts']);
    expect(result).toEqual([false]);
  });

  it('returns mixed results for multiple files', async () => {
    let callCount = 0;
    const sandbox = {
      ...mockSandbox({}),
      exec: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
        if (callCount === 2) return { stdout: 'MISSING', stderr: '', exitCode: 1 };
        return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
      }),
    } as unknown as SandboxExecutor;

    const result = await checkFilesExist(sandbox, ['src/exists.ts', 'src/missing.ts', 'src/also-exists.ts']);
    expect(result).toEqual([true, false, true]);
  });

  it('returns empty array for empty input', async () => {
    const sandbox = mockSandbox({});
    const result = await checkFilesExist(sandbox, []);
    expect(result).toEqual([]);
  });

  it('handles exec errors gracefully', async () => {
    const sandbox = {
      ...mockSandbox({}),
      exec: vi.fn().mockRejectedValue(new Error('sandbox error')),
    } as unknown as SandboxExecutor;

    const result = await checkFilesExist(sandbox, ['src/file.ts']);
    expect(result).toEqual([false]);
  });

  it('all files missing', async () => {
    const sandbox = {
      ...mockSandbox({}),
      exec: vi.fn().mockResolvedValue({ stdout: 'MISSING', stderr: '', exitCode: 1 }),
    } as unknown as SandboxExecutor;

    const result = await checkFilesExist(sandbox, ['src/a.ts', 'src/b.ts']);
    expect(result).toEqual([false, false]);
  });

  it('all files exist', async () => {
    const sandbox = {
      ...mockSandbox({}),
      exec: vi.fn().mockResolvedValue({ stdout: 'EXISTS', stderr: '', exitCode: 0 }),
    } as unknown as SandboxExecutor;

    const result = await checkFilesExist(sandbox, ['src/a.ts', 'src/b.ts']);
    expect(result).toEqual([true, true]);
  });
});

describe('validateIssue', () => {
  it('marks as phantom when triage=unknown and all files missing', async () => {
    const sandbox = {
      ...mockSandbox({}),
      exec: vi.fn().mockResolvedValue({ stdout: 'MISSING', stderr: '', exitCode: 1 }),
    } as unknown as SandboxExecutor;

    const result = await validateIssue(
      sandbox,
      'Fix `src/fake.ts` bug',
      'The file `src/fake.ts` has a bug',
      { type: 'unknown', difficulty: 'unknown', summary: '' },
    );

    expect(result.shouldSkip).toBe(true);
    expect(result.isPhantom).toBe(true);
    expect(result.missingFiles).toEqual(['src/fake.ts']);
    expect(result.existingFiles).toEqual([]);
    expect(result.skipReason).toContain('src/fake.ts');
  });

  it('does not skip when triage=unknown but files exist', async () => {
    const sandbox = {
      ...mockSandbox({}),
      exec: vi.fn().mockResolvedValue({ stdout: 'EXISTS', stderr: '', exitCode: 0 }),
    } as unknown as SandboxExecutor;

    const result = await validateIssue(
      sandbox,
      'Fix `src/real.ts`',
      '',
      { type: 'unknown', difficulty: 'medium', summary: '' },
    );

    expect(result.shouldSkip).toBe(false);
    expect(result.isPhantom).toBe(false);
    expect(result.existingFiles).toEqual(['src/real.ts']);
    expect(result.missingFiles).toEqual([]);
  });

  it('does not skip when triage=bug but files are missing', async () => {
    const sandbox = {
      ...mockSandbox({}),
      exec: vi.fn().mockResolvedValue({ stdout: 'MISSING', stderr: '', exitCode: 1 }),
    } as unknown as SandboxExecutor;

    const result = await validateIssue(
      sandbox,
      'Fix `src/fake.ts`',
      '',
      { type: 'bug', difficulty: 'easy', summary: 'Bug' },
    );

    expect(result.shouldSkip).toBe(false);
    expect(result.isPhantom).toBe(false);
    expect(result.missingFiles).toEqual(['src/fake.ts']);
  });

  it('reports partial match when some files exist and some missing', async () => {
    let callCount = 0;
    const sandbox = {
      ...mockSandbox({}),
      exec: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { stdout: 'EXISTS', stderr: '', exitCode: 0 };
        return { stdout: 'MISSING', stderr: '', exitCode: 1 };
      }),
    } as unknown as SandboxExecutor;

    const result = await validateIssue(
      sandbox,
      'Fix `src/real.ts` and `src/fake.ts`',
      '',
      { type: 'bug', difficulty: 'easy', summary: '' },
    );

    expect(result.shouldSkip).toBe(false);
    expect(result.isPhantom).toBe(false);
    expect(result.existingFiles).toEqual(['src/fake.ts']);
    expect(result.missingFiles).toEqual(['src/real.ts']);
  });

  it('returns skip=false when no file references found', async () => {
    const sandbox = mockSandbox({});
    const result = await validateIssue(
      sandbox,
      'Fix login bug',
      'Users cannot log in',
      { type: 'bug', difficulty: 'easy', summary: '' },
    );

    expect(result.shouldSkip).toBe(false);
    expect(result.referencedFiles).toEqual([]);
    expect(result.missingFiles).toEqual([]);
    expect(result.existingFiles).toEqual([]);
  });

  it('multiple phantom files trigger skip', async () => {
    const sandbox = {
      ...mockSandbox({}),
      exec: vi.fn().mockResolvedValue({ stdout: 'MISSING', stderr: '', exitCode: 1 }),
    } as unknown as SandboxExecutor;

    const result = await validateIssue(
      sandbox,
      'Fix bugs',
      'Check `src/a.ts`, `src/b.py`, `src/c.go`',
      { type: 'unknown', difficulty: 'unknown', summary: '' },
    );

    expect(result.shouldSkip).toBe(true);
    expect(result.isPhantom).toBe(true);
    expect(result.missingFiles).toEqual(['src/a.ts', 'src/b.py', 'src/c.go']);
  });
});
