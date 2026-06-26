import type { Request } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'governance-validation' });

const GOVERNANCE_PROXY_HEADER = 'x-governance-proxy';
const CONTENT_TYPE_HEADER = 'content-type';
const CONTENT_LENGTH_HEADER = 'content-length';

export function isBehindGovernanceProxy(req: Request): boolean {
  return !!req.headers[GOVERNANCE_PROXY_HEADER];
}

export interface ContentTypeCheck {
  valid: boolean;
  contentType: string | null;
}

export function checkContentType(req: Request, allowedTypes: string[]): ContentTypeCheck {
  const contentType = (req.headers[CONTENT_TYPE_HEADER] as string) || null;
  if (!contentType) {
    return { valid: false, contentType: null };
  }
  const baseType = contentType.split(';')[0].trim();
  return {
    valid: allowedTypes.includes(baseType),
    contentType: baseType,
  };
}

export function checkPayloadSize(req: Request, maxBytes: number): boolean {
  const contentLength = parseInt(req.headers[CONTENT_LENGTH_HEADER] as string, 10);
  if (isNaN(contentLength)) {
    return true;
  }
  return contentLength <= maxBytes;
}
