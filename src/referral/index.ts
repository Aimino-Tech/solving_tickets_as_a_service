/**
 * Referral module — REST API routes and barrel export (AIM-4643).
 *
 * Provides:
 * - GET  /api/v1/referral/code              — caller's referral code
 * - POST /api/v1/referral/code              — ensure/generate caller's code
 * - POST /api/v1/referral/redeem            — redeem at signup (public)
 * - POST /api/v1/referral/click             — count a referral-link click (public)
 * - GET  /api/v1/referral/stats             — caller's referral stats
 * - GET  /api/v1/referral/rewards           — list caller's rewards
 * - POST /api/v1/referral/rewards/:id/claim — grant credits + mark claimed
 *
 * @module referral
 */

export { referralRouter } from './routes.js';
export { referralService } from './service.js';
