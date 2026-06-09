import { rootLogger } from '../utils/logger.js';
import type { SandboxExecutor } from '../sandbox/types.js';
import type { TriageResult } from './types.js';

const log = rootLogger.child({ module: 'issue-validator' });

const FILE_PATH_RE = /`([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|scala|swift|php|c|cpp|h|hpp|cs|dart|vue|svelte|css|scss|less|json|yaml|yml|toml|md|sql))`/g;

export interface ValidationResult {
  shouldSkip: boolean;
  skipReason?: string;
  referencedFiles: string[];
  missingFiles: string[];
  existingFiles: string[];
  isPhantom: boolean;
}

/**
 * Extract file path references from issue title and body.
 * Only captures paths with recognized source code file extensions
 * that look like project file references (not URLs).
 */
export function extractFileReferences(title: string, body: string): string[] {
  const text = `${title}\n${body}`;
  const matches = new Set<string>();

  let m: RegExpExecArray | null;
  const re = new RegExp(FILE_PATH_RE);
  while ((m = re.exec(text)) !== null) {
    const path = m[1];
    if (path.startsWith('src/') || path.startsWith('lib/') || path.startsWith('app/') || path.startsWith('packages/')) {
      matches.add(path);
    }
  }

  return Array.from(matches).sort();
}

/**
 * Check which of the given file paths exist in the sandbox.
 * Returns a boolean array parallel to filePaths (true = exists).
 */
export async function checkFilesExist(
  sandbox: SandboxExecutor,
  filePaths: string[],
): Promise<boolean[]> {
  if (filePaths.length === 0) return [];

  const results: boolean[] = [];

  for (const filePath of filePaths) {
    try {
      const safePath = filePath.replace(/'/g, "'\\''");
      const result = await sandbox.exec(`test -f '${safePath}' && echo EXISTS || echo MISSING`, 10_000);
      const exists = result.stdout.trim() === 'EXISTS';
      results.push(exists);
    } catch {
      results.push(false);
    }
  }

  return results;
}

/**
 * Validate an issue by checking whether referenced files actually exist in the repo.
 *
 * Returns a ValidationResult indicating whether the issue should be skipped
 * (phantom issue detection) and lists of missing/existing files.
 */
export async function validateIssue(
  sandbox: SandboxExecutor,
  title: string,
  body: string,
  triage: TriageResult,
): Promise<ValidationResult> {
  const referencedFiles = extractFileReferences(title, body);

  if (referencedFiles.length === 0) {
    return {
      shouldSkip: false,
      referencedFiles: [],
      missingFiles: [],
      existingFiles: [],
      isPhantom: false,
    };
  }

  const existence = await checkFilesExist(sandbox, referencedFiles);
  const existingFiles = referencedFiles.filter((_, i) => existence[i]);
  const missingFiles = referencedFiles.filter((_, i) => !existence[i]);

  const isPhantom = triage.type === 'unknown' && missingFiles.length === referencedFiles.length;

  if (missingFiles.length > 0 && missingFiles.length < referencedFiles.length) {
    log.warn(
      { missingFiles, existingFiles },
      'Issue references some non-existent files',
    );
  }

  if (isPhantom) {
    log.warn(
      { missingFiles, triageType: triage.type },
      'Phantom issue detected — all referenced files missing and triage is unknown',
    );

    return {
      shouldSkip: true,
      skipReason: `The issue references file paths that do not exist in this repository: ${missingFiles.join(', ')}. The triage classified this as "unknown" type, suggesting the issue may not apply to this codebase.`,
      referencedFiles,
      missingFiles,
      existingFiles,
      isPhantom: true,
    };
  }

  return {
    shouldSkip: false,
    referencedFiles,
    missingFiles,
    existingFiles,
    isPhantom: false,
  };
}
