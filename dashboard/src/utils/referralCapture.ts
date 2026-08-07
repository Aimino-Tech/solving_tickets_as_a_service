const STORAGE_KEY = 'syntaro:referral_code';

/**
 * Reads a `ref` or `referral` query parameter from the current URL,
 * persists it in localStorage, and returns the code.
 * Returns null when no referral code is present.
 */
export function captureReferralCodeFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('ref') ?? params.get('referral');
    if (code) {
      localStorage.setItem(STORAGE_KEY, code);
    }
    return code;
  } catch {
    return null;
  }
}
