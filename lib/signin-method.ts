import { cookies } from "next/headers";
import { environment } from "@/lib/config";

/**
 * How a member just signed in, handed from the server to the browser as a short-lived cookie.
 *
 * The usage-event stream starts only for a signed-in visitor, and the server that completes a
 * sign-in has no consent or session to record an event with. So it leaves the method in a cookie
 * (one of a fixed set of words, nothing personal), and the first page the member loads
 * (components/AnalyticsEvents.tsx) records `signed_in` once, if tracking is allowed, and removes it.
 * Same hand-off as notification attribution (lib/notifications/attribution.ts).
 */

import {
  SIGNIN_FAILURE_COOKIE,
  SIGNIN_FAILURE_MAX_AGE_SECONDS,
  SIGNIN_METHOD_COOKIE,
  SIGNIN_METHOD_MAX_AGE_SECONDS,
  addSignInFailure,
  parseSignInFailures,
  serializeSignInFailures,
  type SignInFailureReason,
  type SignInMethod,
} from "@/lib/signin-method-client";

/**
 * The methods are SIGNIN_METHODS (lib/signin-method-client.ts): `email_link` is the one-click link in
 * the sign-in email, `email_code` the code from it typed on /login, `slack_button` the Slack app's
 * "Open Hedgie Hub" button or a link tapped in Slack, `slack_pasted_link` a link copied from Slack and
 * pasted on /login,
 * `slack_continue` the Continue page shown when a click didn't look like a plain browser navigation,
 * and `slack_code` the code from Slack typed on /login.
 */

/** Server: remember how this member signed in, for the browser to report on its next page. Never throws. */
export async function rememberSignInMethod(method: SignInMethod): Promise<void> {
  try {
    (await cookies()).set(SIGNIN_METHOD_COOKIE, method, {
      path: "/",
      maxAge: SIGNIN_METHOD_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure: environment !== "development",
    });
  } catch {
    // Measuring must never get in the way of signing in.
  }
}

/**
 * Server: note a failed sign-in attempt in the visitor's browser (a count per reason, for a day), to
 * be reported as `signin_failed` once they do sign in. Never throws.
 */
export async function rememberSignInFailure(reason: SignInFailureReason): Promise<void> {
  try {
    const store = await cookies();
    const current = parseSignInFailures(store.get(SIGNIN_FAILURE_COOKIE)?.value);
    store.set(SIGNIN_FAILURE_COOKIE, serializeSignInFailures(addSignInFailure(current, reason)), {
      path: "/",
      maxAge: SIGNIN_FAILURE_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure: environment !== "development",
    });
  } catch {
    // Measuring must never get in the way of signing in.
  }
}
