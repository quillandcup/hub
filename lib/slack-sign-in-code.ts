/**
 * Client-safe parsing for Slack sign-in credentials (the server side is lib/slack-sign-in.ts).
 * Lets the sign-in page accept whatever a member copies out of Slack -- the one-time link, the
 * code, or a whole message containing either -- and act on it with no extra clicks.
 */

/** Crockford base32: no I, L, O, U, so codes survive being read aloud or retyped. */
export const SLACK_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SLACK_CODE_LENGTH = 10; // 50 bits

/** Uppercase, drop separators, and fold the look-alikes Crockford base32 leaves out. */
export function normalizeSlackSignInCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function formatSlackSignInCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export type SlackSignInCredential = { kind: "token"; token: string } | { kind: "code"; code: string };

/** Button tokens are 32 random bytes, base64url: 43 characters. */
const TOKEN_IN_LINK = /\/auth\/slack\?token=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;
/** Inside longer text, only the exact form Slack displays (so two ordinary words never match). */
const CODE_IN_TEXT = /(?<![0-9A-Za-z])([0-9A-HJKMNP-TV-Z]{5})-([0-9A-HJKMNP-TV-Z]{5})(?![0-9A-Za-z])/;

/**
 * Find a sign-in credential in pasted text. A link wins over a code (a copied Slack message may
 * hold both; they're the same one-time credential either way). Only the token is taken from a
 * link -- callers navigate to their own /auth/slack with it, never to the pasted host.
 */
export function extractSlackSignInCredential(text: string): SlackSignInCredential | null {
  const link = TOKEN_IN_LINK.exec(text);
  if (link) return { kind: "token", token: link[1] };

  const trimmed = text.trim();
  const normalized = normalizeSlackSignInCode(trimmed);
  if (normalized.length === SLACK_CODE_LENGTH && trimmed.length <= SLACK_CODE_LENGTH + 2) {
    return { kind: "code", code: normalized };
  }

  const code = CODE_IN_TEXT.exec(text);
  if (code) return { kind: "code", code: normalizeSlackSignInCode(code[1] + code[2]) };
  return null;
}
