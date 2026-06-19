import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

export interface Receipt {
  id: string;
  step: string;
  filePath: string;
  hash: string;
  timestamp: string;
  previousHash: string | null;
}

export interface ReceiptChain {
  receipts: Receipt[];
}

export async function createReceipt(
  step: string,
  filePath: string,
  previousReceipt: Receipt | null,
): Promise<Receipt> {
  let content: Buffer;
  try {
    content = await readFile(filePath);
  } catch {
    content = Buffer.from(`step:${step}:${Date.now()}`);
  }
  const hash = createHash('sha256').update(content).digest('hex');
  return {
    id: `${step}-${Date.now()}`,
    step,
    filePath,
    hash,
    timestamp: new Date().toISOString(),
    previousHash: previousReceipt ? previousReceipt.hash : null,
  };
}

export async function verifyReceipt(receipt: Receipt): Promise<boolean> {
  try {
    const content = await readFile(receipt.filePath);
    const currentHash = createHash('sha256').update(content).digest('hex');
    return currentHash === receipt.hash;
  } catch {
    return false;
  }
}

export async function verifyReceiptChain(chain: ReceiptChain): Promise<{
  valid: boolean;
  tampered: string[];
}> {
  const tampered: string[] = [];

  for (let i = 0; i < chain.receipts.length; i++) {
    const receipt = chain.receipts[i];
    const isValid = await verifyReceipt(receipt);
    if (!isValid) tampered.push(receipt.filePath);

    if (i > 0) {
      const previousReceipt = chain.receipts[i - 1];
      if (receipt.previousHash !== previousReceipt.hash) {
        tampered.push(`chain-break-at-${receipt.step}`);
      }
    }
  }

  return { valid: tampered.length === 0, tampered };
}

export async function createReceiptChain(steps: Array<{ step: string; filePath: string }>): Promise<ReceiptChain> {
  const receipts: Receipt[] = [];
  let previous: Receipt | null = null;

  for (const { step, filePath } of steps) {
    const receipt = await createReceipt(step, filePath, previous);
    receipts.push(receipt);
    previous = receipt;
  }

  return { receipts };
}
