import { createHash } from "crypto";

const KAJABI_CDN = "https://kajabi-storefronts-production.kajabi-cdn.com/kajabi-storefronts-production/";

/**
 * Avatar fallback chain: Kajabi photo -> Slack photo -> Gravatar -> (client-side initials).
 * See MemberAvatar.tsx for the initials fallback, triggered by the Gravatar
 * `d=404` param 404-ing and the <img> onError handler.
 */
function gravatarUrl(email: string): string {
  // d=404 means 404 if the address has no Gravatar account (onError → initials).
  const hash = createHash("md5").update(email.toLowerCase().trim()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=404&s=200`;
}

export function toKajabiPhotoUrl(
  path: string | null | undefined,
  email: string,
  slackImageUrl: string | null | undefined
): string {
  if (path) {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      // Kajabi's own `avatar` field documents itself as "a custom uploaded
      // avatar or falls back to Gravatar" — i.e. Kajabi sometimes hands back
      // a Gravatar URL it built itself, without the `d=404` this codebase
      // relies on for the onError → initials fallback. Without that param,
      // Gravatar returns its generic default image for anyone with no real
      // account, and (depending on the exact URL Kajabi constructs) that can
      // still fail to render for reasons this app doesn't control. Rebuild
      // it ourselves instead of trusting Kajabi's version verbatim, so the
      // same reliable d=404-driven fallback always applies.
      if (path.includes("gravatar.com/avatar")) return gravatarUrl(email);
      return path;
    }
    return KAJABI_CDN + path;
  }
  // No custom Kajabi avatar — try their Slack profile photo next (real,
  // uploaded photos only; see extractSlackImageUrl below).
  if (slackImageUrl) return slackImageUrl;
  // No Slack photo either — try Gravatar; d=404 means 404 if no account (onError → initials)
  return gravatarUrl(email);
}

/**
 * Slack always returns image_192/image_512 for every user, even ones who
 * never uploaded a photo — it fills in a Gravatar-derived or generic
 * identicon URL in that case, and its avatar_hash for those synthetic images
 * is prefixed "g" (vs. a real hash for an uploaded photo). Only surface the
 * URL when it's an actual uploaded photo, so it doesn't short-circuit
 * toKajabiPhotoUrl's own Gravatar/initials fallback with Slack's generic
 * avatar art instead.
 */
export function extractSlackImageUrl(profile: {
  avatar_hash?: string | null;
  image_192?: string | null;
  image_512?: string | null;
} | null | undefined): string | null {
  const avatarHash = profile?.avatar_hash;
  const hasCustomPhoto = !!avatarHash && !avatarHash.startsWith("g");
  if (!hasCustomPhoto) return null;
  return profile?.image_192 || profile?.image_512 || null;
}
