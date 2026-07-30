import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { config } from '../config.js';

const standardResponse = (_req: Request, res: Response) => {
  res.status(429).json({ error: 'Too many requests' });
};

export const loginLimiter = rateLimit({
  windowMs: config.auth.rateLimitWindowMs,
  max: config.auth.loginRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardResponse,
});

export const registerLimiter = rateLimit({
  windowMs: config.auth.rateLimitWindowMs,
  max: config.auth.registerRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardResponse,
});

export const refreshLimiter = rateLimit({
  windowMs: config.auth.rateLimitWindowMs,
  max: config.auth.refreshRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardResponse,
});
