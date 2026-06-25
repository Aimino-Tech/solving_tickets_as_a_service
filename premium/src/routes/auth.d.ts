/**
 * GitHub OAuth authentication routes for the premium dashboard.
 *
 * GET  /api/auth/github      - Redirect to GitHub OAuth authorization
 * GET  /api/auth/callback    - OAuth callback: exchange code for token
 * GET  /api/auth/me          - Return current user info (requires JWT)
 * POST /api/auth/logout      - Invalidate session (placeholder)
 */
declare const router: import("express-serve-static-core").Router;
export { router as authRouter };
