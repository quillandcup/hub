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

import { SIGNIN_METHOD_COOKIE, SIGNIN_METHOD_MAX_AGE_SECONDS, type SignInMethod } from "@/lib/signin-method-client";

/**
 * The methods are SIGNIN_METHODS (lib/signin-method-client.ts): `email_link` is the one-click link in
 * the sign-in email, `email_code` the code from it typed on /login, `slack_link` the Slack app's
 * "Open Hedgie Hub" button or a copied sign-in link (one route; they can't be told apart),
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
