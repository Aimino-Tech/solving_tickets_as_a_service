/**
 * RapidAPI authentication middleware.
 *
 * Validates the X-RapidAPI-Proxy-Secret header to ensure requests are
 * proxied through RapidAPI's platform. Extracts the subscriber tier from
 * the X-RapidAPI-User-Rate-Limit header and sets req.plan accordingly.
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config.js';

export function rapidApiAuth(req: Request, res: Response, next: NextFunction) {
  const proxySecret = req.headers['x-rapidapi-proxy-secret'] as string | undefined;

  if (!proxySecret || proxySecret !== config.rapidapi.proxySecret) {
    return res.status(401).json({ error: 'Invalid or missing RapidAPI proxy secret' });
  }

  // Extract tier from rate limit header set by RapidAPI
  const rateLimit = req.headers['x-rapidapi-user-rate-limit'] as string | undefined;

  if (rateLimit && rateLimit.includes('1000')) {
    req.plan = 'enterprise';
  } else if (rateLimit && rateLimit.includes('100')) {
    req.plan = 'pro';
  } else {
    req.plan = 'free';
  }

  next();
}
