import { INSTAGRAM_SPEC, parseSocialHandle } from "@/lib/social-links";

/**
 * Kajabi-owned member profile fields (bio + social links) and how they map
 * into Silver `members`.
 *
 * Where each field lives in Kajabi, and whether our API credentials can write it:
 *
 * | members column  | Kajabi source                                   | Writable via public API? |
 * |-----------------|-------------------------------------------------|--------------------------|
 * | bio             | customer.public_bio                             | No — /v1/customers is read-only |
 * | facebook_url    | customer.socials.facebook                       | No |
 * | twitter_url     | customer.socials.twitter                        | No |
 * | instagram_url   | contact custom field "Instagram Handle"         | Yes (the custom field) |
 *                     (custom_1), else customer.socials.instagram
 *
 * Kajabi's public API (help.kajabi.com/api-reference, v1 — the only version,
 * mirrored in lib/kajabi/openapi.yaml) exposes only GET for /v1/customers and
 * /v1/customers/{id} (plus offer grants); there is no customer/profile update
 * endpoint, no scope that adds one, and no webhook for profile changes. So
 * public_bio/socials.* are read-only to us. PATCH /v1/contacts/{id} does
 * accept custom_1..custom_3.
 */

// Kajabi contact custom field for "Instagram Handle" — confirmed via
// GET /v1/custom_fields (site 2147577478) to be handle `custom_1`. It's
// collected on our lead forms (e.g. the "Ideal Hedgie" opt-in), so it's
// normally set, and it's what members edit from Settings > Profile. The
// customer's socials.instagram only exists if they filled in Kajabi's member
// directory profile (most don't), so it's just the fallback.
export const INSTAGRAM_CUSTOM_FIELD_HANDLE = "custom_1" as const;

/**
 * members.instagram_url from the two Kajabi sources: the "Instagram Handle"
 * custom field wins; socials.instagram is the fallback when it's empty.
 * Shared by /api/process/members and the Settings profile editor.
 */
export function resolveInstagramUrl(
  customFieldHandle: string | null | undefined,
  socialsInstagram: string | null | undefined
): string | null {
  return toSocialUrl(INSTAGRAM_BASE_URL, customFieldHandle) ?? toSocialUrl(INSTAGRAM_BASE_URL, socialsInstagram);
}

export function toSocialUrl(base: string, handle: string | null | undefined): string | null {
  if (!handle) return null;
  const trimmed = handle.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  // Strip leading @, /, spaces; strip trailing /
  const clean = trimmed.replace(/^[@/\s]+/, "").replace(/\/+$/, "");
  if (!clean) return null;
  return `${base}/${clean}`;
}

export const INSTAGRAM_BASE_URL = "https://instagram.com";

/**
 * Normalise what a member typed for their Instagram into a bare handle
 * (no @), which is what the Kajabi "Instagram Handle" opt-in form collects.
 *
 * Accepts "@handle", "handle", or an http(s) instagram.com profile URL.
 * An empty string means "clear it" and returns { handle: null }.
 */
export function parseInstagramInput(input: string): { handle: string | null } | { error: string } {
  return parseSocialHandle(input, INSTAGRAM_SPEC);
}
