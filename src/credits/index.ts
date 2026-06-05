/**
 * Credits module — REST API routes, deduct middleware, and barrel export.
 *
 * Provides:
 * - GET  /api/v1/credits/balance       — current credit balance
 * - GET  /api/v1/credits/transactions   — paginated transaction history
 * - POST /api/v1/credits/top-up         — initiate Stripe Checkout purchase
 * - GET  /api/v1/credits/usage          — usage statistics (daily/weekly/monthly)
 * - POST /api/v1/admin/credits/adjust   — admin credit adjustment
 * - deductMiddleware                    — Express middleware to check & deduct credits
 *
 * Usage:
 *   ```ts
 *   import { creditRouter, deductMiddleware } from './credits/index.js';
 *   app.use('/api/v1', creditRouter);
 *   app.use('/webhook', deductMiddleware, handleWebhook);
 *   ```
 *
 * @module credits
 */

export { creditRouter } from './routes.js';
export { deductMiddleware, refundCredits } from './middleware.js';
