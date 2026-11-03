/**
 * What happened at the points where signing in can fail, as one structured log line each, so a
 * launch (or any week) can be read from the logs: `vercel logs --query "signin:"` (see
 * .claude/rules/read-only-clis.md). Signed-out visitors aren't in the usage-event stream on purpose
 * (docs/ANALYTICS.md), so this is the record of failures before sign-in.
 *
 * Never an email, name, code, token or member id: only the outcome and Supabase's error code.
 */

export type SignInOutcome =
  /** /auth/callback got no `code` at all (link opened without it). */
  | "callback_no_code"
  /** The link was opened in a different browser than the one that asked for it (PKCE verifier missing): the cross-device case. */
  | "callback_other_browser"
  /** The link's code was refused for any other reason (expired, already used). */
  | "callback_refused"
  /** A typed email code worked. */
  | "code_ok"
  /** A typed email code was refused (expired, wrong, replaced by a newer email). */
  | "code_refused"
  /** What was typed wasn't a code (wrong length, letters), so Supabase was not asked. */
  | "code_malformed";

/** Supabase's error codes that mean "the browser that holds the PKCE secret isn't this one". */
const OTHER_BROWSER_CODES = new Set(["pkce_code_verifier_not_found"]);

export function callbackOutcome(error: { code?: string | null; name?: string | null } | null | undefined): SignInOutcome {
  const code = error?.code ?? error?.name ?? "";
  return OTHER_BROWSER_CODES.has(code) || code === "AuthPKCECodeVerifierMissingError" ? "callback_other_browser" : "callback_refused";
}

export function logSignIn(outcome: SignInOutcome, error?: { code?: string | null; status?: number | null; name?: string | null } | null) {
  const line: Record<string, string | number> = { outcome };
  if (error?.code) line.error_code = error.code;
  else if (error?.name) line.error_code = error.name;
  if (error?.status) line.status = error.status;
  console.log(`signin: ${JSON.stringify(line)}`);
}
