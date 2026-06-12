/**
 * Global Express type augmentation.
 *
 * Extends the Express Request interface with properties used for
 * request correlation, authentication, and plan-based rate limiting.
 */

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      adminId?: string;
      accountId?: string;
      /** Subscriber plan tier set by RapidAPI auth middleware */
      plan?: 'free' | 'pro' | 'enterprise';
    }
  }
}

export {};
