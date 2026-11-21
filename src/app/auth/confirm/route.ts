import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isBrowserNavigation } from "@/lib/browser-navigation";
import { parseConfirmParams, type ConfirmParams } from "@/lib/auth-confirm";
import { takeNextPath } from "@/lib/next-path-cookie";
import { logSignIn } from "@/lib/signin-log";
import { rememberSignInFailure, rememberSignInMethod } from "@/lib/signin-method";

/**
 * Target of the link in the sign-in, invitation and recovery emails (supabase/emails, built into the
 * Supabase templates): /auth/confirm?token_hash=...&type=...
 *
 * The link carries a hashed one-time token that `verifyOtp` checks on the server, so it needs no secret
 * held by the browser that asked (the old PKCE link, /auth/callback, only worked there) and works from a
 * phone's mail app after asking on a laptop.
 *
 * A GET that spends a credential should only do so for a real top-level browser navigation (mail scanners
 * and link checkers open links too, and would spend it): the same guard as the Slack button
 * (src/app/auth/slack/route.ts, src/lib/browser-navigation.ts). A member clicking the link is signed in at once,
 * with no extra page; anything else is sent to the Continue page, whose button (a POST) is the only thing
 * that spends the token then. The token is never logged: only the outcome is (src/lib/signin-log.ts).
 *
 * This only signs in (a session at the first factor). Staff with a two-step factor are stopped at the code
 * check by the admin gate afterwards, exactly as after the old link (src/lib/staff-mfa.ts).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const params = parseConfirmParams(url.searchParams);

  if (!params) {
    // An old PKCE link that reached us here (the template was changed after it was sent): hand it to the callback.
    if (url.searchParams.get("code")) return NextResponse.redirect(new URL(`/auth/callback${url.search}`, origin), 307);
    return failed(origin, "confirm_no_token", "link_no_code");
  }

  if (!isBrowserNavigation(request.headers)) {
    const continueUrl = new URL("/auth/confirm/continue", origin);
    continueUrl.searchParams.set("token_hash", params.tokenHash);
    continueUrl.searchParams.set("type", params.type);
    if (params.next) continueUrl.searchParams.set("next", params.next);
    return NextResponse.redirect(continueUrl, 303);
  }

  return confirm(origin, params, "email_link");
}

/** The Continue page's button. A 303 so the browser follows with a GET. */
export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failed(origin, "confirm_no_token", "link_no_code");
  }
  const params = parseConfirmParams(form);
  if (!params) return failed(origin, "confirm_no_token", "link_no_code");
  return confirm(origin, params, "email_continue");
}

async function confirm(origin: string, params: ConfirmParams, method: "email_link" | "email_continue") {
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type });
  if (error) return failed(origin, "confirm_refused", "link_refused", error);
  await rememberSignInMethod(method);
  const next = params.next ?? (await takeNextPath());
  return NextResponse.redirect(new URL(next, origin), 303);
}

/** Back to the login page, which shows the typed-code box for this case (the code in the same email works on any device). */
async function failed(
  origin: string,
  outcome: "confirm_no_token" | "confirm_refused",
  reason: "link_no_code" | "link_refused",
  error?: { code?: string | null; status?: number | null; name?: string | null }
) {
  logSignIn(outcome, error);
  await rememberSignInFailure(reason);
  return NextResponse.redirect(new URL("/login?error=auth_callback_failed", origin), 303);
}
