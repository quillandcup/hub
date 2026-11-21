/**
 * Validation for member-entered social links. Members may type a handle
 * ("@name" / "name") or paste a profile link; links must be http(s) and point
 * at the network's own domain, and are normalised to a bare handle.
 */

export interface SocialNetworkSpec {
  /** Shown in error messages, e.g. "Instagram". */
  label: string;
  /** Shown in "isn't a … profile" errors, e.g. "instagram.com". */
  domain: string;
  hosts: ReadonlySet<string>;
  handlePattern: RegExp;
  handleRules: string;
  maxInputLength?: number;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Parse a handle or profile URL for `spec`. Blank input means "clear" and returns { handle: null }. */
export function parseSocialHandle(
  input: string,
  spec: SocialNetworkSpec
): { handle: string | null } | { error: string } {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return { handle: null };
  if (trimmed.length > (spec.maxInputLength ?? 200)) return { error: "That's too long for a handle" };

  let candidate = trimmed;
  if (SCHEME_RE.test(trimmed) || trimmed.includes("/")) {
    let url: URL;
    try {
      url = new URL(SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      return { error: `Enter a handle like @yourname or a link to your ${spec.domain} profile` };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { error: "Links must start with http:// or https://" };
    }
    if (!spec.hosts.has(url.hostname.toLowerCase())) {
      return { error: `That link doesn't go to a profile on ${spec.domain}` };
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return { error: `That link doesn't go to a profile on ${spec.domain}` };
    candidate = segments[0];
  }

  const handle = candidate.replace(/^@+/, "");
  if (!spec.handlePattern.test(handle)) {
    return { error: `${spec.label} handles ${spec.handleRules}` };
  }
  return { handle };
}

export const INSTAGRAM_SPEC: SocialNetworkSpec = {
  label: "Instagram",
  domain: "instagram.com",
  hosts: new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]),
  // Letters, digits, periods, underscores; max 30 chars.
  handlePattern: /^[A-Za-z0-9._]{1,30}$/,
  handleRules: "can only use letters, numbers, periods and underscores (max 30)",
};

export const X_SPEC: SocialNetworkSpec = {
  label: "X",
  domain: "x.com",
  hosts: new Set(["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]),
  // Letters, digits, underscores; max 15 chars.
  handlePattern: /^[A-Za-z0-9_]{1,15}$/,
  handleRules: "can only use letters, numbers and underscores (max 15)",
};

export const FACEBOOK_SPEC: SocialNetworkSpec = {
  label: "Facebook",
  domain: "facebook.com",
  hosts: new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.com", "www.fb.com"]),
  // Usernames: letters, digits, periods; Facebook requires at least 5.
  handlePattern: /^[A-Za-z0-9.]{5,50}$/,
  handleRules: "can only use letters, numbers and periods (5–50 characters)",
};

export const X_BASE_URL = "https://x.com";
export const FACEBOOK_BASE_URL = "https://facebook.com";

/** X profile URL (https://x.com/handle) from member input, or null to clear. */
export function parseXInput(input: string): { url: string | null } | { error: string } {
  const parsed = parseSocialHandle(input, X_SPEC);
  if ("error" in parsed) return parsed;
  return { url: parsed.handle ? `${X_BASE_URL}/${parsed.handle}` : null };
}

/**
 * Facebook profile URL from member input, or null to clear. Also accepts
 * numeric-ID profile links (facebook.com/profile.php?id=123), which have no
 * username to normalise to.
 */
export function parseFacebookInput(input: string): { url: string | null } | { error: string } {
  const trimmed = (input ?? "").trim();
  const profileIdMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.|m\.|web\.)?facebook\.com\/profile\.php\?id=(\d{1,25})(?:&.*)?$/i
  );
  if (profileIdMatch) return { url: `${FACEBOOK_BASE_URL}/profile.php?id=${profileIdMatch[1]}` };

  const parsed = parseSocialHandle(input, FACEBOOK_SPEC);
  if ("error" in parsed) return parsed;
  return { url: parsed.handle ? `${FACEBOOK_BASE_URL}/${parsed.handle}` : null };
}

export const MAX_BIO_LENGTH = 1000;

/** Trimmed bio (line endings normalised), or null to clear. */
export function parseBioInput(input: string): { bio: string | null } | { error: string } {
  const bio = (input ?? "").replace(/\r\n?/g, "\n").trim();
  if (!bio) return { bio: null };
  if (bio.length > MAX_BIO_LENGTH) {
    return { error: `Keep your bio to ${MAX_BIO_LENGTH} characters (it's ${bio.length})` };
  }
  return { bio };
}
