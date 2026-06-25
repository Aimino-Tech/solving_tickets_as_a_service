/**
 * JWT authentication middleware for premium dashboard API.
 *
 * Verifies Bearer tokens issued by the GitHub OAuth flow.
 * Attaches user info (githubId, username, avatar) to `req.user`.
 *
 * Environment:
 *   DASHBOARD_JWT_SECRET — HMAC secret for signing tokens (default: auto-generated)
 */
import type { Request, Response, NextFunction } from 'express';
export interface JwtPayload {
    sub: string;
    username: string;
    avatar_url?: string;
    iat: number;
    exp: number;
    iss: string;
}
export declare function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss'>): string;
export declare function verifyJwt(token: string): JwtPayload | null;
export declare function jwtAuth(req: Request, res: Response, next: NextFunction): void;
export declare function optionalAuth(req: Request, _res: Response, next: NextFunction): void;
declare global {
    namespace Express {
        interface Request {
            user?: {
                githubId: string;
                username: string;
                avatarUrl?: string;
            };
        }
    }
}
