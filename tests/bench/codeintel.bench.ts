/**
 * Benchmark: Code Intelligence Build Time
 *
 * Measures the time to:
 * 1. Scan file structure (find command simulation)
 * 2. Run tsc --noEmit --listFiles (simulated)
 * 3. Extract symbols and imports
 * 4. Build the CodeIntel structure
 *
 * This simulates the work done in issueAgent.ts's buildCodeIntelligence().
 */

import { bench, describe } from 'vitest';
import { createMockCodeIntelInput } from './setup.js';

const mockIntel = createMockCodeIntelInput();

// ── Simulated file structure scan ────────────────────────────────────

interface CodeIntel {
  symbols: string[];
  imports: Record<string, string[]>;
  fileStructure: string;
}

function simulateFindCommand(baseDir: string, excludeDirs: string[]): string {
  const excludes = excludeDirs.map((d) => `-not -path './${d}/*'`).join(' ');
  return `find ${baseDir} -type f ${excludes} 2>/dev/null | head -200`;
}

function scanFileStructure(fileListing: string): string[] {
  return fileListing.split('\n').filter(Boolean).slice(0, 200);
}

function extractSymbols(fileStructure: string[], sourceFiles: string[]): string[] {
  const symbols: string[] = [];
  for (const file of sourceFiles) {
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      // Simulate extracting export/function/class names from a file path
      const name = file.split('/').pop()?.replace(/\.(ts|tsx)$/, '') ?? '';
      if (name) symbols.push(name);
    }
  }
  return symbols.slice(0, 100);
}

function extractImports(fileStructure: string[]): Record<string, string[]> {
  const imports: Record<string, string[]> = {};
  for (const file of fileStructure) {
    // Simulate import extraction from file names
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      imports[file] = ['express', 'zod', 'pino'];
    }
  }
  return imports;
}

function buildCodeIntel(fileStructureStr: string): CodeIntel {
  const files = scanFileStructure(fileStructureStr);
  const symbols = extractSymbols(files, files);
  const imports = extractImports(files);

  return {
    symbols,
    imports,
    fileStructure: fileStructureStr,
  };
}

describe('code-intelligence', () => {
  bench('simulate find command string construction', () => {
    simulateFindCommand('.', ['node_modules', '.git', 'dist']);
  });

  bench('scan file structure (split + filter)', () => {
    scanFileStructure(mockIntel.fileStructure);
  });

  bench('extract symbols from file paths', () => {
    const files = scanFileStructure(mockIntel.fileStructure);
    extractSymbols(files, files);
  });

  bench('extract imports from file listing', () => {
    const files = scanFileStructure(mockIntel.fileStructure);
    extractImports(files);
  });

  bench('full code intelligence build pipeline', () => {
    buildCodeIntel(mockIntel.fileStructure);
  });
});
