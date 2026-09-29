import { after } from "next/server";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { findSlackUserForToken, publishSlackHome, signInSlackUser } from "@/lib/slack-sign-in";
import { takeNextPath } from "@/lib/next-path-cookie";

/**
 * Shared tail of every Slack sign-in path (button click in app/auth/slack/route.ts, the Continue
 * fallback and the typed code in ./actions.ts): create the session for the Slack user a spent
 * credential belonged to, put a fresh button in their Home tab for next time, and pick where to
 * send them (the page they were bounced from, else home).
 */
export async function finishSlackSignIn(
  service: SupabaseClient,
  slackUserId: string,
  origin: string
): Promise<{ ok: true; next: string } | { ok: false; error: "unavailable" | "failed" }> {
  const result = await signInSlackUser(service, await createClient(), slackUserId);
  if (!result.ok) return { ok: false, error: result.reason };

  refreshHomeLater(service, slackUserId, origin);
  return { ok: true, next: await takeNextPath() };
}

/**
 * A button token that's expired or already used still tells us whose it was: refresh their Home
 * tab so the button waiting for them in Slack works. Returns whether it did.
 */
export async function refreshHomeForDeadToken(service: SupabaseClient, token: string, origin: string): Promise<boolean> {
  const slackUserId = await findSlackUserForToken(service, token);
  if (!slackUserId) return false;
  refreshHomeLater(service, slackUserId, origin);
  return true;
}

function refreshHomeLater(service: SupabaseClient, slackUserId: string, origin: string) {
  after(async () => {
    try {
      await publishSlackHome(service, slackUserId, origin);
    } catch (error) {
      console.error("Error refreshing Slack Home tab for %s:", slackUserId, error);
    }
  });
}

/** Origin of the current server action request. */
export async function actionOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}
