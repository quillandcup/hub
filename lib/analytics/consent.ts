/** Where the consent banner (components/ConsentBanner.tsx) keeps the visitor's choice. */
export const CONSENT_STORAGE_KEY = "ga-consent";

/** Fired on `window` when the visitor accepts or declines, so tracking can start or stop at once. */
export const CONSENT_CHANGE_EVENT = "hub-consent-change";

/**
 * Whether usage events may be recorded. Where consent is required (visitors in the EU, EEA and UK,
 * and anywhere we can't tell; see lib/gdpr-countries.ts) that means an explicit "granted": no
 * answer yet counts as no, the same as Google Analytics. Elsewhere it is on.
 */
export function eventsAllowed(needsConsent: boolean, stored: string | null): boolean {
  return !needsConsent || stored === "granted";
}
