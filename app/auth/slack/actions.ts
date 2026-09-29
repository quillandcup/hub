"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { consumeSlackSignIn, slackCodeRateLimits } from "@/lib/slack-sign-in";
import { clientIpFrom, hitRateLimits } from "@/lib/rate-limit";
import { actionOrigin, finishSlackSignIn, refreshHomeForDeadToken } from "./finish";

/**
 * "Continue to Hedgie Hub" on /auth/slack/continue: the fallback for button clicks that didn't
 * arrive as a plain browser navigation (see ./route.ts). Spends the button token only now.
 */
export async function completeSlackSignIn(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const service = createServiceRoleClient();
  const origin = await actionOrigin();

  const slackUserId = await consumeSlackSignIn(service, { token });
  if (!slackUserId) {
    const refreshed = await refreshHomeForDeadToken(service, token, origin);
    redirect(`/auth/slack/continue?error=expired${refreshed ? "&refreshed=1" : ""}`);
  }

  const result = await finishSlackSignIn(service, slackUserId, origin);
  if (!result.ok) redirect(`/auth/slack/continue?error=${result.error}`);
  redirect(result.next);
}

export interface SlackCodeState {
  error: string;
}

/**
 * The code shown under the button in Slack, typed into /login on another browser -- e.g. Safari
 * on iPhone, which doesn't share cookies with the in-app browser Slack opens links in.
 */
export async function signInWithSlackCode(_prev: SlackCodeState | null, formData: FormData): Promise<SlackCodeState> {
  const code = String(formData.get("code") ?? "");
  const service = createServiceRoleClient();

  // Wrong codes never reach Supabase Auth (we check them against our own table), so its per-IP
  // verification limit doesn't apply here -- this is ours.
  if (!(await hitRateLimits(service, slackCodeRateLimits(clientIpFrom(await headers()))))) {
    return {
      error:
        "Too many sign-in attempts. Wait a few minutes, or use the Open Hedgie Hub button in Slack or sign in by email.",
    };
  }

  const slackUserId = await consumeSlackSignIn(service, { code });
  if (!slackUserId) {
    return {
      error:
        "That code didn't work. It may have expired or already been used. Open the Hedgie Hub app in Slack for a fresh one.",
    };
  }

  const result = await finishSlackSignIn(service, slackUserId, await actionOrigin());
  if (!result.ok) {
    return {
      error:
        result.error === "unavailable"
          ? "Signing in from Slack isn't available for this account. Please sign in by email."
          : "Something went wrong signing you in. Please try again.",
    };
  }
  redirect(result.next);
}
