/**
 * Global Express type augmentation.
 *
 * Extends the Express Request interface with a `requestId` property
 * used for request correlation across the system.
 */

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      adminId?: string;
      accountId?: string;
    }
  }
}

export {};
