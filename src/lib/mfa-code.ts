/** A TOTP code is six digits (Supabase Auth's default). */
export const MFA_CODE_LENGTH = 6;

/** What was typed, reduced to its digits: authenticator apps show the code as "123 456", and a paste can carry spaces. */
export function cleanMfaCode(typed: string): string {
  return typed.replace(/\D/g, "");
}
