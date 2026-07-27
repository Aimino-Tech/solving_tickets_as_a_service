import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export interface AuthUser {
  id: number;
  githubLogin: string;
  tier: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
      sub: string;
      githubLogin: string;
      tier: string;
      exp: number;
    };
    if (payload.exp * 1000 < Date.now()) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }
    req.user = {
      id: Number(payload.sub),
      githubLogin: payload.githubLogin,
      tier: payload.tier,
    } as any;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
