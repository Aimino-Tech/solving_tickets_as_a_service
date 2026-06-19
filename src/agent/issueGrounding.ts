import type { SandboxExecutor } from '../sandbox/types.js';
import { rootLogger } from '../utils/logger.js';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

const log = rootLogger.child({ module: 'issue-grounding' });

export interface GroundingClaim {
  text: string;
  type: 'file' | 'function' | 'class' | 'import' | 'behavior';
  found: boolean;
  location?: string;
  evidence?: string;
}

export interface GroundingResult {
  passed: boolean;
  claimsChecked: GroundingClaim[];
  hallucinatedClaims: string[];
  totalClaims: number;
  verifiedClaims: number;
}

export interface WorkflowReceipt {
  id: string;
  step: string;
  filePath: string;
  hash: string;
  timestamp: string;
  previousHash: string | null;
}

export interface ReceiptChain {
  receipts: WorkflowReceipt[];
}

export function extractIssueClaims(issueBody: string): GroundingClaim[] {
  const claims: GroundingClaim[] = [];
  if (!issueBody) return claims;

  const filePathRe = /(?:src|lib|app|packages|tests?)\/[^\s,;`'")]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|swift|php|c|cpp|h|cs|dart|vue|svelte|css|scss|less|json|yaml|yml|toml|md|sql)/g;
  let m: RegExpExecArray | null;
  while ((m = filePathRe.exec(issueBody)) !== null) {
    claims.push({ text: m[0], type: 'file', found: false });
  }

  const functionRe = /(?:function|fn|method|func)\s+(\w+)/gi;
  while ((m = functionRe.exec(issueBody)) !== null) {
    claims.push({ text: m[1], type: 'function', found: false });
  }

  const classRe = /(?:class|type|interface)\s+(\w+)/gi;
  while ((m = classRe.exec(issueBody)) !== null) {
    claims.push({ text: m[1], type: 'class', found: false });
  }

  return deduplicateClaims(claims);
}

export function extractAgentClaims(agentOutput: string): GroundingClaim[] {
  const claims: GroundingClaim[] = [];
  if (!agentOutput) return claims;

  const fileRe = /(?:src|lib|app|packages|tests?)\/[^\s,;`'")]+\.(?:ts|tsx|js|jsx|py|go|rs|json)/g;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(agentOutput)) !== null) {
    claims.push({ text: m[0], type: 'file', found: false });
  }

  const fnRe = /(?:function|def|func)\s+(\w+)/gi;
  while ((m = fnRe.exec(agentOutput)) !== null) {
    claims.push({ text: m[1], type: 'function', found: false });
  }

  const classRe = /(?:class|struct)\s+(\w+)/gi;
  while ((m = classRe.exec(agentOutput)) !== null) {
    claims.push({ text: m[1], type: 'class', found: false });
  }

  return deduplicateClaims(claims);
}

function deduplicateClaims(claims: GroundingClaim[]): GroundingClaim[] {
  const seen = new Set<string>();
  return claims.filter(c => {
    const key = `${c.type}:${c.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function verifyClaims(sandbox: SandboxExecutor, claims: GroundingClaim[], repoDir: string): Promise<GroundingResult> {
  const verified: GroundingClaim[] = [];
  const hallucinated: string[] = [];

  for (const claim of claims) {
    try {
      let result: { stdout: string; stderr: string; exitCode: number };

      switch (claim.type) {
        case 'file':
          result = await sandbox.exec(`test -f '${claim.text.replace(/'/g, "'\\''")}' && echo EXISTS || echo MISSING`, 10_000);
          claim.found = result.stdout.trim() === 'EXISTS';
          if (claim.found) claim.location = claim.text;
          break;

        case 'function': {
          const escapedFn = claim.text.replace(/[^a-zA-Z0-9_]/g, '');
          result = await sandbox.exec(
            `grep -rn "function\\s\\+${escapedFn}\\|fn\\s\\+${escapedFn}\\|def\\s\\+${escapedFn}" ${repoDir}/src --include='*.ts' --include='*.tsx' --include='*.js' --include='*.py' 2>/dev/null | head -3`,
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
          const escapedCls = claim.text.replace(/[^a-zA-Z0-9_]/g, '');
          result = await sandbox.exec(
            `grep -rn "class\\s\\+${escapedCls}\\|struct\\s\\+${escapedCls}\\|interface\\s\\+${escapedCls}" ${repoDir}/src --include='*.ts' --include='*.tsx' --include='*.rs' 2>/dev/null | head -3`,
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

        case 'import':
          result = await sandbox.exec(`grep -rn "from\\s\\+'${claim.text}'\\|require(\\s*'${claim.text}'" ${repoDir}/src 2>/dev/null | head -3`, 30_000);
          claim.found = result.stdout.trim().length > 0;
          break;

        default:
          claim.found = true;
      }

      if (!claim.found) hallucinated.push(claim.text);
      verified.push(claim);
    } catch (err) {
      claim.found = false;
      hallucinated.push(claim.text);
      verified.push(claim);
      log.warn({ claim: claim.text, err: String(err) }, 'Claim verification error');
    }
  }

  return {
    passed: hallucinated.length === 0,
    claimsChecked: verified,
    hallucinatedClaims: hallucinated,
    totalClaims: claims.length,
    verifiedClaims: verified.filter(c => c.found).length,
  };
}

export async function checkIssueGrounding(
  sandbox: SandboxExecutor,
  issueBody: string,
  agentOutput: string,
  repoDir: string,
): Promise<GroundingResult> {
  const issueClaims = extractIssueClaims(issueBody);
  const agentClaims = extractAgentClaims(agentOutput);
  const allClaims = [...issueClaims, ...agentClaims];
  const uniqueClaims = deduplicateClaims(allClaims);

  if (uniqueClaims.length === 0) {
    return { passed: true, claimsChecked: [], hallucinatedClaims: [], totalClaims: 0, verifiedClaims: 0 };
  }

  log.info({ totalClaims: uniqueClaims.length }, 'Verifying claims against codebase');
  return verifyClaims(sandbox, uniqueClaims, repoDir);
}

export function createReceipt(step: string, content: string, previousHash: string | null): WorkflowReceipt {
  const hash = createHash('sha256').update(content).digest('hex');
  return {
    id: `${step}-${Date.now()}`,
    step,
    filePath: `step:${step}`,
    hash,
    timestamp: new Date().toISOString(),
    previousHash,
  };
}

export async function createFileReceipt(step: string, filePath: string, previousHash: string | null): Promise<WorkflowReceipt> {
  let content: Buffer;
  try {
    content = await readFile(filePath);
  } catch {
    content = Buffer.from('');
  }
  const hash = createHash('sha256').update(content).digest('hex');
  return {
    id: `${step}-${Date.now()}`,
    step,
    filePath,
    hash,
    timestamp: new Date().toISOString(),
    previousHash,
  };
}

export function verifyReceiptHash(receipt: WorkflowReceipt, content: string): boolean {
  const computedHash = createHash('sha256').update(content).digest('hex');
  return computedHash === receipt.hash;
}

export function verifyReceiptChain(chain: ReceiptChain): { valid: boolean; tamperedSteps: string[] } {
  const tamperedSteps: string[] = [];

  for (let i = 0; i < chain.receipts.length; i++) {
    const receipt = chain.receipts[i];

    if (i > 0) {
      const prev = chain.receipts[i - 1];
      if (receipt.previousHash !== prev.hash) {
        tamperedSteps.push(`chain-break-at-${receipt.step}`);
      }
    }
  }

  return { valid: tamperedSteps.length === 0, tamperedSteps };
}
