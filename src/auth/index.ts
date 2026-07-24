export { authService, AuthError } from './service.js';
export type { AuthResult, TokenPayload } from './service.js';
export { requireAuth, optionalAuth } from './middleware.js';
export type { AuthUser } from './middleware.js';
export { default as authRouter } from './routes.js';
