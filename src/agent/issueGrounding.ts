import { rootLogger } from '../utils/logger.js';
import type { SandboxExecutor } from '../sandbox/types.js';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

const log = rootLogger.child({ module: 'issue-grounding' });

export interface GroundingCheck {
  claim: string;
  type: 'file' | 'function' | 'class' | 'import' | 'behavior';
  found: boolean;
  location?: string;
  evidence?: string;
}

export interface GroundingResult {
  passed: boolean;
  checks: GroundingCheck[];
  hallucinatedClaims: string[];
  totalChecked: number;
  verifiedCount: number;
}

export function extractClaims(agentOutput: string): GroundingCheck[] {
  const claims: GroundingCheck[] = [];
  if (!agentOutput) return claims;

  const fileRe = /(?:src|lib|app|packages|tests?)\/[^\s,;`'")]+\.(?:ts|tsx|js|jsx|py|go|rs|json)/g;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(agentOutput)) !== null) {
    claims.push({ claim: m[0], type: 'file', found: false });
  }

  const fnRe = /(?:function|def|func)\s+(\w+)/gi;
  while ((m = fnRe.exec(agentOutput)) !== null) {
    claims.push({ claim: m[1], type: 'function', found: false });
  }

  const classRe = /(?:class|struct|interface)\s+(\w+)/gi;
  while ((m = classRe.exec(agentOutput)) !== null) {
    claims.push({ claim: m[1], type: 'class', found: false });
  }

  const importRe = /(?:from\s+['"]|require\s*\(\s*['"])([^'"]+)['"]/g;
  while ((m = importRe.exec(agentOutput)) !== null) {
    claims.push({ claim: m[1], type: 'import', found: false });
  }

  const seen = new Set<string>();
  return claims.filter(c => {
    const key = `${c.type}:${c.claim}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function verifyClaims(
  sandbox: SandboxExecutor,
  claims: GroundingCheck[],
  repoDir: string,
): Promise<GroundingResult> {
  const verified: GroundingCheck[] = [];
  const hallucinated: string[] = [];

  for (const claim of claims) {
    try {
      let result: { stdout: string; stderr: string; exitCode: number };

      switch (claim.type) {
        case 'file': {
          const safePath = claim.claim.replace(/'/g, "'\\''");
          result = await sandbox.exec(`test -f '${safePath}' && echo EXISTS || echo MISSING`, 10_000);
          claim.found = result.stdout.trim() === 'EXISTS';
          if (claim.found) claim.location = claim.claim;
          break;
        }
        case 'function': {
          const escaped = claim.claim.replace(/[^a-zA-Z0-9_]/g, '');
          result = await sandbox.exec(
            `grep -rn "function\\\\s\\\\+${escaped}\\\\|fn\\\\s\\\\+${escaped}\\\\|def\\\\s\\\\+${escaped}" ${repoDir}/src 2>/dev/null | head -3`,
            30_000,
          );
          claim.found = result.stdout.trim().length > 0;
          if (claim.found) {
            const firstLine = result.stdout.split('\n')[0];
            claim.location = firstLine.split(':')[0];
            claim.evidence = firstLine;
          }
          break;
        }
        case 'class': {
          const escaped = claim.claim.replace(/[^a-zA-Z0-9_]/g, '');
          result = await sandbox.exec(
            `grep -rn "class\\\\s\\\\+${escaped}\\\\|struct\\\\s\\\\+${escaped}\\\\|interface\\\\s\\\\+${escaped}" ${repoDir}/src 2>/dev/null | head -3`,
            30_000,
          );
          claim.found = result.stdout.trim().length > 0;
          if (claim.found) {
            const firstLine = result.stdout.split('\n')[0];
            claim.location = firstLine.split(':')[0];
            claim.evidence = firstLine;
          }
          break;
        }
        default:
          claim.found = true;
      }

      if (!claim.found) hallucinated.push(claim.claim);
      verified.push(claim);
    } catch (err) {
      claim.found = false;
      hallucinated.push(claim.claim);
      verified.push(claim);
    }
  }

  return {
    passed: hallucinated.length === 0,
    checks: verified,
    hallucinatedClaims: hallucinated,
    totalChecked: claims.length,
    verifiedCount: verified.filter(c => c.found).length,
  };
}

export async function checkIssueGrounding(
  sandbox: SandboxExecutor,
  agentOutput: string,
  repoDir: string,
): Promise<GroundingResult> {
  const claims = extractClaims(agentOutput);
  if (claims.length === 0) {
    return { passed: true, checks: [], hallucinatedClaims: [], totalChecked: 0, verifiedCount: 0 };
  }
  log.info({ totalClaims: claims.length }, 'Verifying claims against real codebase');
  return verifyClaims(sandbox, claims, repoDir);
}
