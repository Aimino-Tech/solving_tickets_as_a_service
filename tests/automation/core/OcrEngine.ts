import fs from 'node:fs';
import { execSync } from 'node:child_process';

export interface OcrResult {
  text: string;
  confidence: number;
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}

export interface OcrEngineOptions {
  /** oc-vision MCP server URL (default: http://localhost:3100) */
  ocVisionUrl?: string;
  /** Fallback to tesseract CLI if oc-vision unavailable */
  useTesseractFallback?: boolean;
}

export class OcrEngine {
  private ocVisionUrl: string;
  private useTesseractFallback: boolean;

  constructor(options: OcrEngineOptions = {}) {
    this.ocVisionUrl = options.ocVisionUrl || process.env.OC_VISION_MCP_URL || 'http://localhost:3100';
    this.useTesseractFallback = options.useTesseractFallback !== false;
  }

  async extractText(imagePath: string): Promise<OcrResult> {
    try {
      return await this.extractViaOcVision(imagePath);
    } catch {
      if (this.useTesseractFallback) {
        return this.extractViaTesseract(imagePath);
      }
      throw new Error('OCR unavailable: oc-vision MCP not reachable and tesseract fallback disabled');
    }
  }

  private async extractViaOcVision(imagePath: string): Promise<OcrResult> {
    const { readFileSync } = await import('node:fs');
    const imageBase64 = readFileSync(imagePath).toString('base64');

    const resp = await fetch(`${this.ocVisionUrl}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
    });

    if (!resp.ok) throw new Error(`oc-vision OCR failed: ${resp.status}`);
    const data = (await resp.json()) as OcrResult;
    return data;
  }

  private extractViaTesseract(imagePath: string): OcrResult {
    try {
      execSync('which tesseract', { stdio: 'ignore' });
    } catch {
      throw new Error('tesseract CLI not found. Install with: apt-get install tesseract-ocr');
    }

    const output = execSync(`tesseract "${imagePath}" stdout 2>/dev/null`, { encoding: 'utf-8' });
    const text = output.trim();

    const words = text
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({
        text: w,
        confidence: 100,
        bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
      }));

    return {
      text,
      confidence: words.length > 0 ? 100 : 0,
      words,
    };
  }
}
