import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { resolvePlatformRole } from './roles.js';
import { authService } from './service.js';

const log = rootLogger.child({ module: 'auth-middleware' });

export interface AuthUser {
  id: string;
  email: string;
  role?: string;
  impersonatorId?: string;
  impersonatorEmail?: string;
  purpose?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function userFromPayload(payload: {
  sub: string;
  email: string;
  role?: string;
  impersonatorId?: string;
  impersonatorEmail?: string;
  purpose?: string;
}): AuthUser {
  return {
    id: String(payload.sub),
    email: payload.email,
    role: payload.role,
    ...(payload.impersonatorId ? { impersonatorId: payload.impersonatorId } : {}),
    ...(payload.impersonatorEmail ? { impersonatorEmail: payload.impersonatorEmail } : {}),
    ...(payload.purpose ? { purpose: payload.purpose } : {}),
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = authService.verifyToken(token);
    req.user = userFromPayload(payload);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = header.slice(7);
  try {
    const payload = authService.verifyToken(token);
    req.user = userFromPayload(payload);
  } catch {
    // Token invalid — continue without auth
  }
  next();
}

export function requireVerifiedEmail(_req: Request, res: Response, next: NextFunction): void {
  next();
}

/**
 * Platform admin gate (dashboard JWT).
 * Blocks impersonation tokens. Resolves role from JWT / ADMIN_EMAILS / users.role.
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    if (req.user?.purpose === 'impersonation' || req.user?.impersonatorId) {
      log.warn(
        { email: req.user.email, impersonatorId: req.user.impersonatorId, path: req.path },
        'Forbidden admin attempt while impersonating',
      );
      res.status(403).json({ error: 'Forbidden — cannot use admin tools while impersonating' });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const email = req.user.email?.toLowerCase();
    if (email && config.adminSteering.adminEmails.includes(email)) {
      req.user.role = 'admin';
      next();
      return;
    }

    const role =
      req.user.role === 'admin'
        ? 'admin'
        : await resolvePlatformRole({
            userId: req.user.id,
            email: req.user.email,
            appMetadataRole: req.user.role ?? null,
          });

    if (role === 'admin') {
      req.user.role = 'admin';
      next();
      return;
    }

    log.warn({ email: req.user.email, role, ip: req.ip, path: req.path }, 'Forbidden platform admin attempt');
    res.status(403).json({ error: 'Forbidden — account is not an administrator' });
  })();
}
