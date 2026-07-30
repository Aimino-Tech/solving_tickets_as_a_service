import { requireAuth as _requireAuth } from '../auth/middleware.js';
import type { AuthUser as _AuthUser } from '../auth/middleware.js';

export type AuthUser = _AuthUser;
export const requireAuth = _requireAuth;
