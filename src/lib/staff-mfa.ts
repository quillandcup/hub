import { STAFF_MFA_REQUIRED_FROM } from "@/lib/config";

/**
 * Second sign-in step for staff (docs/trust/STAFF_MFA.md): a TOTP code from an authenticator app, through Supabase Auth's MFA.
 * Pure (usable in the proxy and in client components); reading the session's level and factors is src/lib/staff-mfa.server.ts.
 *
 * A session is `aal1` after a link or code sign-in and `aal2` once it has also passed a TOTP challenge. For staff:
 *
 * - has a verified factor but the session is aal1 -> `challenge` (always, whether or not the requirement is on yet: a
 *   stolen link must not be enough for an account that chose the second step)
 * - no factor, requirement on (`STAFF_MFA_REQUIRED_FROM` has passed) -> `enrol`
 * - no factor, requirement not on yet -> `suggest`: let them in, the admin layout shows a banner
 * - aal2 -> `ok`
 */
export type StaffMfaState = "ok" | "challenge" | "enrol" | "suggest";

/** The factor type this uses. Supabase lists others (phone, WebAuthn); only a verified TOTP counts. */
export const STAFF_MFA_FACTOR_TYPE = "totp";

/** Whether the requirement is on at `now` (epoch ms). Off when unset, and when the configured value isn't a date. */
export function isStaffMfaEnforced(now: number, requiredFrom: string | null = STAFF_MFA_REQUIRED_FROM): boolean {
  if (!requiredFrom) return false;
  const from = Date.parse(requiredFrom);
  return Number.isFinite(from) && now >= from;
}

/** Whether these factors (a Supabase user's `factors`) include a verified TOTP. An abandoned set-up is unverified and doesn't count. */
export function hasVerifiedTotp(factors: ReadonlyArray<{ factor_type?: string; status?: string }> | null | undefined): boolean {
  return (factors ?? []).some((f) => f.factor_type === STAFF_MFA_FACTOR_TYPE && f.status === "verified");
}

export function staffMfaState({ aal, hasFactor, enforced }: { aal: string | null | undefined; hasFactor: boolean; enforced: boolean }): StaffMfaState {
  if (aal === "aal2") return "ok";
  if (hasFactor) return "challenge";
  return enforced ? "enrol" : "suggest";
}

/** Whether a state stops the visitor from reaching the admin area (`suggest` only shows a banner). */
export function blocksStaff(state: StaffMfaState): boolean {
  return state === "challenge" || state === "enrol";
}
