/**
 * Referral program constants (AIM-4643).
 *
 * Reward is $5 for both referrer and referee, converted to credits.
 * The established credit rate is $1 = 100 credits ($0.01/credit), which is
 * the basis of the credit packs in src/stripe/credit-packs.ts.
 */

/** Credits per US dollar at the established $0.01/credit rate. */
export const CREDITS_PER_USD = 100;

/** Referral reward in USD — both the referrer and the referee get $5. */
export const REFERRAL_REWARD_USD = 5;

/** Referral reward in credits ($5 × 100 credits per dollar = 500). */
export const REFERRAL_REWARD_CREDITS = REFERRAL_REWARD_USD * CREDITS_PER_USD;

/**
 * Referral reward in fixes — the product unit is FIXES with metered usage,
 * not prepaid credits (syntaro.io/pricing: "Prepaid credit packs are not
 * part of the Syntaro pricing model"). Both the referrer and the referee
 * receive 10 fixes, granted as an account-level fixes allowance that the
 * quota gate consumes past the plan limit. The credit constants above are
 * kept for legacy purchases and rate reference only.
 */
export const REFERRAL_REWARD_FIXES = 10;

/** Length of generated referral codes (8-char uppercase base32). */
export const REFERRAL_CODE_LENGTH = 8;

/**
 * Known disposable/temporary email providers. Redemption from these domains
 * is blocked — account-farmers use them to mint fresh referral rewards.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'guerrillamail.com',
  'guerrillamail.org',
  '10minutemail.com',
  'yopmail.com',
  'trashmail.com',
  'throwawaymail.com',
  'getnada.com',
  'maildrop.cc',
  'sharklasers.com',
  'mailnesia.com',
  'dispostable.com',
  'mytemp.email',
  'tempinbox.com',
  'mailcatch.com',
  'mailsac.com',
  'emailondeck.com',
  'fakeinbox.com',
  'inboxkitten.com',
  'mailinator2.com',
  'spam4.me',
]);
