/**
 * ISO 3166-1 alpha-2 country codes that require opt-in consent before
 * analytics cookies fire, per GDPR (EU + EEA) and UK GDPR/PECR.
 *
 * Used with the `x-vercel-ip-country` header (Vercel's edge geolocation) to
 * decide whether to show the Google Consent Mode banner in app/layout.tsx.
 */
export const GDPR_CONSENT_COUNTRIES = new Set([
  // EU member states
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  // EEA (non-EU)
  "IS", "LI", "NO",
  // UK (UK GDPR / PECR)
  "GB",
]);

export function countryNeedsConsent(countryCode: string | null | undefined): boolean {
  if (!countryCode) {
    // Unknown location (e.g. local dev, header missing) -- default to the
    // safer assumption and require consent rather than silently tracking.
    return true;
  }
  return GDPR_CONSENT_COUNTRIES.has(countryCode.toUpperCase());
}
