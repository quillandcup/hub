import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { consumeSlackSignIn } from "@/lib/slack-sign-in";
import { finishSlackSignIn, refreshHomeForDeadToken } from "./finish";

/**
 * Target of the Slack app's "Open Hedgie Hub" button (lib/slack-sign-in.ts). A click signs the
 * member in and lands them where they were headed, with no intermediate page.
 *
 * Slack never unfurls Block Kit button URLs, but a GET that spends a credential should still only
 * do so for a real top-level browser navigation. Browsers send Sec-Fetch-Mode: navigate and
 * Sec-Fetch-Dest: document for that; link checkers, prefetchers and scripts don't. Anything else
 * (including browsers too old to send the headers) gets the Continue page, which spends the token
 * only on an explicit click.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const origin = url.origin;

  const isNavigation =
    request.headers.get("sec-fetch-mode") === "navigate" && request.headers.get("sec-fetch-dest") === "document";
  if (!isNavigation) {
    const continueUrl = new URL("/auth/slack/continue", origin);
    if (token) continueUrl.searchParams.set("token", token);
    return NextResponse.redirect(continueUrl, 303);
  }

  const service = createServiceRoleClient();
  const slackUserId = await consumeSlackSignIn(service, { token });
  if (!slackUserId) {
    const refreshed = await refreshHomeForDeadToken(service, token, origin);
    return NextResponse.redirect(new URL(`/auth/slack/continue?error=expired${refreshed ? "&refreshed=1" : ""}`, origin), 303);
  }

  const result = await finishSlackSignIn(service, slackUserId, origin);
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/auth/slack/continue?error=${result.error}`, origin), 303);
  }
  return NextResponse.redirect(new URL(result.next, origin), 303);
}
