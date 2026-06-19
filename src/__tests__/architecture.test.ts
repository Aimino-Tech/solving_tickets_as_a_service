import { describe, it, expect } from 'vitest';

describe('architecture: no mock on core infrastructure', () => {
  const testFilesPattern = /__tests__\/.*\.test\.ts$/;

  it('test files must not import SandboxExecutor directly', async () => {
    const { readdirSync, readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');

    const srcDir = join(process.cwd(), 'src');
    const violations: string[] = [];

    function walkDir(dir: string) {
      let entries: string[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch { return; }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          walkDir(fullPath);
        } else if (entry.isFile() && testFilesPattern.test(fullPath)) {
          const content = readFileSync(fullPath, 'utf-8');
          if (content.includes('SandboxExecutor') || content.includes('sandbox/executor')) {
            violations.push(fullPath);
          }
        }
      }
    }

    walkDir(srcDir);
    expect(violations).toEqual([]);
  });

  it('test files must not mock qualityGates module', async () => {
    const { readdirSync, readFileSync } = await import('fs');
    const { join } = await import('path');

    const srcDir = join(process.cwd(), 'src');
    const violations: string[] = [];

    function walkDir(dir: string) {
      let entries: string[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch { return; }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          walkDir(fullPath);
        } else if (entry.isFile() && testFilesPattern.test(fullPath)) {
          const content = readFileSync(fullPath, 'utf-8');
          if (content.includes('mock') && (content.includes('qualityGates') || content.includes('../agent/qualityGates'))) {
            violations.push(fullPath);
          }
        }
      }
    }

    walkDir(srcDir);
    expect(violations).toEqual([]);
  });
});
