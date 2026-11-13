import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { botInstallState, buildBotInstallUrl, isBotInstallTarget } from "@/lib/slack-bot-install";
import { isSlackConnectConfigured, setConnectStateCookie } from "@/lib/slack-connect";

/**
 * Start installing Billie Bot (its token, not a member's) through Slack's OAuth flow: admins only. The recovery
 * path for a lost bot refresh token, see docs/SECRET_ROTATION.md. Slack sends the admin back to the member-connect
 * callback, which recognises this flow by its state and finishes it (lib/slack-bot-install.ts).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user || auth.forbidden) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!isSlackConnectConfigured()) return NextResponse.json({ error: "SLACK_CLIENT_ID and SLACK_CLIENT_SECRET are not set" }, { status: 503 });

  // ?workspace= is "primary" (default), "new" (Slack asks which workspace) or the Slack team id of a registered one.
  const requested = request.nextUrl.searchParams.get("workspace") ?? "primary";
  if (!isBotInstallTarget(requested)) return NextResponse.json({ error: "workspace must be primary, new or a Slack team id" }, { status: 400 });

  const state = await setConnectStateCookie(botInstallState(requested, ""));
  const teamId = requested === "primary" ? undefined : requested === "new" ? null : requested;
  return NextResponse.redirect(buildBotInstallUrl(state, teamId));
}
