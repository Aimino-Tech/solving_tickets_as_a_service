/**
 * Mock mail transport for magic-link auth (AIM-4496).
 *
 * No real SMTP dependency: in dev it returns a preview URL so the magic link
 * flow is fully exercisable without an email provider. Swap the `send` export
 * for a nodemailer implementation when SMTP credentials exist.
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'mail-transport' });

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Magic-link URL that would be embedded in the email. */
  linkUrl: string;
}

export interface MailSendResult {
  sent: boolean;
  /** Preview URL (dev only) or empty when a real transport is configured. */
  previewUrl: string;
}

/**
 * Send an email. Current implementation is a mock transport: it logs the
 * message and returns a preview URL carrying the magic-link token. It never
 * fails, so tests and dev flows work without SMTP.
 */
export async function sendMail(message: MailMessage): Promise<MailSendResult> {
  log.info(
    { to: message.to, subject: message.subject, linkUrl: message.linkUrl },
    'Mock mail transport — email not actually delivered',
  );
  return { sent: true, previewUrl: message.linkUrl };
}
