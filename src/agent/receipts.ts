import { createHash } from 'node:crypto';

export const REQUIRED_PHASES = ['triage', 'investigate', 'fix', 'verify'] as const;
export type ReceiptPhase = (typeof REQUIRED_PHASES)[number];
export type ReceiptPhaseSet = Record<ReceiptPhase, Receipt>;

export interface Receipt {
  phase: ReceiptPhase;
  inputHash: string;
  outputHash: string;
  artifactUrl: string;
  timestamp: string;
}

export function computeHash(data: unknown): string {
  let serialized: string;
  if (typeof data === 'string') {
    serialized = data;
  } else {
    serialized = JSON.stringify(data) ?? 'undefined';
  }
  return createHash('sha256').update(serialized).digest('hex');
}

export function createReceipt(phase: ReceiptPhase, input: unknown, output: unknown, artifactUrl: string): Receipt {
  return {
    phase,
    inputHash: computeHash(input),
    outputHash: computeHash(output),
    artifactUrl,
    timestamp: new Date().toISOString(),
  };
}

export interface ReceiptManifest {
  receipts: Partial<ReceiptPhaseSet>;
  createdAt: string;
}

export function createManifest(): ReceiptManifest {
  return { receipts: {}, createdAt: new Date().toISOString() };
}

export function addReceipt(manifest: ReceiptManifest, receipt: Receipt): ReceiptManifest {
  return {
    ...manifest,
    receipts: { ...manifest.receipts, [receipt.phase]: receipt },
  };
}

export function verifyAllReceipts(manifest: ReceiptManifest): { valid: boolean; missing: ReceiptPhase[] } {
  const missing: ReceiptPhase[] = [];
  for (const phase of REQUIRED_PHASES) {
    if (!manifest.receipts[phase]) {
      missing.push(phase);
    }
  }
  return { valid: missing.length === 0, missing };
}

export function serializeReceiptsJson(manifest: ReceiptManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function receiptsToMarkdown(manifest: ReceiptManifest): string {
  const lines: string[] = [
    '## Workflow Receipts',
    '',
    '| Phase | Input Hash | Output Hash | Artifact | Timestamp |',
    '|---|---|---|---|---|',
  ];

  for (const phase of REQUIRED_PHASES) {
    const receipt = manifest.receipts[phase];
    if (receipt) {
      lines.push(
        `| ${receipt.phase} | \`${receipt.inputHash.slice(0, 12)}\` | \`${receipt.outputHash.slice(0, 12)}\` | ${receipt.artifactUrl} | ${receipt.timestamp} |`,
      );
    } else {
      lines.push(`| ${phase} | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |`);
    }
  }

  lines.push('', `_Receipt manifest generated at ${manifest.createdAt}_`);
  return lines.join('\n');
}
