import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/safe-next";

/**
 * The emailed sign-in, invitation and recovery links point at /auth/confirm?token_hash=...&type=...
 * (Supabase's documented server-side pattern: the email carries the hashed one-time token and our route
 * checks it with `verifyOtp`, so nothing is held by the browser that asked and the link works on any
 * device). These are the pure parts; the route is app/auth/confirm/route.ts.
 */

/** The types the email templates send (supabase/templates, built by scripts/_email-templates.ts). `email` is the sign-in link. */
export const CONFIRM_TYPES = ["email", "magiclink", "invite", "recovery"] as const satisfies readonly EmailOtpType[];
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

export type ConfirmParams = { tokenHash: string; type: ConfirmType; next: string | null };

/** Supabase's hashed tokens are hex or url-safe base64; anything else is not ours and is never sent to Supabase. */
const TOKEN_HASH = /^[A-Za-z0-9_-]{8,200}$/;

type Source = { get(name: string): unknown };

/** Reads and validates the parameters from the query (GET) or the Continue form (POST). Null when there is nothing to check. */
export function parseConfirmParams(source: Source): ConfirmParams | null {
  const tokenHash = String(source.get("token_hash") ?? "");
  const type = String(source.get("type") ?? "");
  if (!TOKEN_HASH.test(tokenHash) || !(CONFIRM_TYPES as readonly string[]).includes(type)) return null;
  // Only ever a same-site path (open redirects: see lib/safe-next.ts); otherwise the remembered page, else home.
  return { tokenHash, type: type as ConfirmType, next: safeNextPath(String(source.get("next") ?? "")) };
}
