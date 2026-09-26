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
 * | instagram_url   | customer.socials.instagram, else contact custom | Only the contact custom field |
 *                     field "Instagram Handle" (custom_1)
 *
 * Kajabi's API reference (and the vendored lib/kajabi/openapi.yaml) only
 * exposes GET for /v1/customers and /v1/customers/{id}; there is no update
 * endpoint, so public_bio/socials can only be changed by the member inside
 * Kajabi itself. PATCH /v1/contacts/{id} does accept custom_1..custom_3.
 */

// Kajabi contact custom field for "Instagram Handle" — confirmed via
// GET /v1/custom_fields (site 2147577478) to be handle `custom_1`. Most
// Kajabi customers never fill in the native profile socials.instagram field,
// but this custom field is collected on the "Ideal Hedgie" opt-in form at
// signup, so it's the primary source; socials.instagram still wins when a
// customer has explicitly set it, since that's the more current value.
export const INSTAGRAM_CUSTOM_FIELD_HANDLE = "custom_1" as const;

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

// Instagram usernames: letters, digits, periods, underscores; max 30 chars.
const INSTAGRAM_HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const MAX_INSTAGRAM_INPUT_LENGTH = 200;
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

/**
 * Normalise what a member typed for their Instagram into a bare handle
 * (no @), which is what the Kajabi "Instagram Handle" opt-in form collects.
 *
 * Accepts "@handle", "handle", or an http(s) instagram.com profile URL.
 * An empty string means "clear it" and returns { handle: null }.
 */
export function parseInstagramInput(input: string): { handle: string | null } | { error: string } {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return { handle: null };
  if (trimmed.length > MAX_INSTAGRAM_INPUT_LENGTH) return { error: "That's too long for an Instagram handle" };

  let candidate = trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.includes("/")) {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      return { error: "Enter an Instagram handle like @yourname or an instagram.com link" };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { error: "Links must start with http:// or https://" };
    }
    if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) {
      return { error: "That link isn't an instagram.com profile" };
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return { error: "That link isn't an instagram.com profile" };
    candidate = segments[0];
  }

  const handle = candidate.replace(/^@+/, "");
  if (!INSTAGRAM_HANDLE_RE.test(handle)) {
    return { error: "Instagram handles can only use letters, numbers, periods and underscores (max 30)" };
  }
  return { handle };
}
