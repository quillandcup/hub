import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { buildBotInstallUrl, BOT_STATE_PREFIX } from "@/lib/slack-bot-install";
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

  const state = await setConnectStateCookie(BOT_STATE_PREFIX);
  return NextResponse.redirect(buildBotInstallUrl(state));
}
