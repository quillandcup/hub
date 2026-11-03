/**
 * How a member just signed in, as the browser sees it (the server half is lib/signin-method.ts,
 * which holds the explanation). Kept free of server-only imports so client components can use it.
 */

export const SIGNIN_METHOD_COOKIE = "hub_signin_method";
export const SIGNIN_METHOD_MAX_AGE_SECONDS = 5 * 60;

export const SIGNIN_METHODS = ["email_link", "email_code", "slack_button", "slack_pasted_link", "slack_continue", "slack_code"] as const;
export type SignInMethod = (typeof SIGNIN_METHODS)[number];

export function isSignInMethod(value: unknown): value is SignInMethod {
  return typeof value === "string" && (SIGNIN_METHODS as readonly string[]).includes(value);
}

/** Browser: the method in a `document.cookie` string, or null (missing or not one of ours). */
export function readSignInMethod(cookieString: string): SignInMethod | null {
  for (const part of cookieString.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === SIGNIN_METHOD_COOKIE) return isSignInMethod(value) ? value : null;
  }
  return null;
}

/** Browser: remove the cookie once it has been read. */
export function clearSignInMethod(): void {
  document.cookie = `${SIGNIN_METHOD_COOKIE}=; path=/; max-age=0`;
}

/**
 * Sign-in failures a member ran into, carried in a cookie until they sign in, then reported as
 * `signin_failed` events (components/AnalyticsEvents.tsx). A failure happens before anyone is signed
 * in, and the usage-event stream is for signed-in members only, so the failure rides with the browser
 * and is reported by the first signed-in page. People who never get in aren't in the events; the
 * server logs (lib/signin-log.ts) cover them.
 *
 * `link_other_browser`: the emailed link was opened in a different browser than the one that asked.
 * `link_refused`: the link was expired or already used. `link_no_code`: the callback was opened with
 * nothing in it. `code_refused` / `code_malformed`: a typed email code was wrong, expired or not a
 * code. `slack_link_expired`: a Slack sign-in link was expired or used. `slack_code_refused`: a typed
 * Slack code was wrong, expired or used.
 */
export const SIGNIN_FAILURE_COOKIE = "hub_signin_failures";
export const SIGNIN_FAILURE_MAX_AGE_SECONDS = 24 * 60 * 60;
export const SIGNIN_FAILURE_REASONS = [
  "link_other_browser",
  "link_refused",
  "link_no_code",
  "code_refused",
  "code_malformed",
  "slack_link_expired",
  "slack_code_refused",
] as const;
export type SignInFailureReason = (typeof SIGNIN_FAILURE_REASONS)[number];
/** More than this of one kind says nothing more; it also keeps the cookie small. */
export const SIGNIN_FAILURE_MAX_COUNT = 9;

export type SignInFailures = Partial<Record<SignInFailureReason, number>>;

export function isSignInFailureReason(value: unknown): value is SignInFailureReason {
  return typeof value === "string" && (SIGNIN_FAILURE_REASONS as readonly string[]).includes(value);
}

/** `reason:count` pairs joined by commas; anything not ours or out of range is dropped. */
export function parseSignInFailures(value: string | undefined | null): SignInFailures {
  const out: SignInFailures = {};
  for (const pair of (value ?? "").split(",")) {
    const [reason, raw] = pair.split(":");
    const count = Number(raw);
    if (isSignInFailureReason(reason) && Number.isInteger(count) && count >= 1) {
      out[reason] = Math.min(count, SIGNIN_FAILURE_MAX_COUNT);
    }
  }
  return out;
}

export function serializeSignInFailures(failures: SignInFailures): string {
  return SIGNIN_FAILURE_REASONS.filter((r) => failures[r])
    .map((r) => `${r}:${failures[r]}`)
    .join(",");
}

export function addSignInFailure(failures: SignInFailures, reason: SignInFailureReason): SignInFailures {
  return { ...failures, [reason]: Math.min((failures[reason] ?? 0) + 1, SIGNIN_FAILURE_MAX_COUNT) };
}

/** Browser: the failures in a `document.cookie` string (the value is URL-encoded there). */
export function readSignInFailures(cookieString: string): SignInFailures {
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== SIGNIN_FAILURE_COOKIE) continue;
    try {
      return parseSignInFailures(decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      return {};
    }
  }
  return {};
}

/** Browser: remove the cookie once it has been read. */
export function clearSignInFailures(): void {
  document.cookie = `${SIGNIN_FAILURE_COOKIE}=; path=/; max-age=0`;
}
