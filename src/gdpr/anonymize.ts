import { createHash } from 'node:crypto';

const SALT = process.env.GDPR_ANONYMIZATION_SALT ?? 'stas-anonymize';

function hashToken(prefix: string, value: string): string {
  return createHash('sha256').update(`${prefix}:${value}:${SALT}`).digest('hex').slice(0, 16);
}

export interface AnonymizedPii {
  email: string | null;
  name: string | null;
}

export function anonymizePii(email?: string | null, name?: string | null): AnonymizedPii {
  let anonymizedEmail: string | null = null;
  if (email && typeof email === 'string' && email.includes('@')) {
    const local = email.split('@')[0];
    anonymizedEmail = `user-${hashToken('email', email)}@deleted.invalid`;
    if (local) {
      anonymizedEmail = `${local}-${hashToken('email', email)}@deleted.invalid`;
    }
  }
  const anonymizedName = name ? `User ${hashToken('name', name).slice(0, 8)}` : null;
  return { email: anonymizedEmail, name: anonymizedName };
}

export function isAnonymizedEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.endsWith('@deleted.invalid');
}
