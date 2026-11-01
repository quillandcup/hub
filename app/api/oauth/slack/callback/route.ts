import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { BOT_STATE_PREFIX, completeBotInstall } from "@/lib/slack-bot-install";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  consumeConnectStateCookie,
  exchangeSlackCode,
  isSlackConnectConfigured,
  linkSlackAccount,
  saveSlackConnection,
} from "@/lib/slack-connect";

/**
 * Where Slack sends the member back after they approve (or refuse). This exact path is the redirect
 * URL registered in slack-app-manifest.yml. Checks the flow started in this browser (state cookie),
 * that the signed-in member is the one connecting (not in sudo), and that the Slack account that
 * approved is in our workspace and not another member's (it is bound to them now, replacing any
 * guess), then stores the user token in Vault.
 */
export async function GET(request: NextRequest) {
  // An admin installing the bot itself (/api/oauth/slack/bot/start) comes back here too: one registered redirect URL.
  if (request.nextUrl.searchParams.get("state")?.startsWith(BOT_STATE_PREFIX)) return finishBotInstall(request);

  const back = (reason: string) => NextResponse.redirect(new URL(`/settings?slack=${reason}`, request.nextUrl.origin));

  const params = request.nextUrl.searchParams;
  const stateOk = await consumeConnectStateCookie(params.get("state"));

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  const identity = await getEffectiveIdentity(user);
  if (!identity) return back("no_member");
  if (identity.isSudo) return back("sudo");
  if (!isSlackConnectConfigured()) return back("unavailable");
  if (!stateOk) return back("invalid_state");

  const code = params.get("code");
  if (params.get("error") || !code) return back("declined");

  try {
    const grant = await exchangeSlackCode(code);
    const service = createServiceRoleClient();
    const link = await linkSlackAccount(service, grant, identity.memberId, user.id);
    if (!link.ok) return back(link.reason);
    await saveSlackConnection(service, identity.memberId, grant);
    return back("connected");
  } catch (error) {
    console.error("Slack connect failed:", error);
    return back("failed");
  }
}

const BOT_INSTALL_PROBLEMS: Record<string, string> = {
  wrong_workspace: "That is a different Slack workspace from ours. Nothing was stored.",
  not_rotating: "Slack didn't return a refresh token (is token rotation on for the app?), so the token couldn't be kept alive. Nothing was stored.",
  slack: "Slack refused the approval or the code. Nothing was stored. Try again from /api/oauth/slack/bot/start.",
  store: "Slack approved it but the token couldn't be stored. Check the Vercel logs. The install can be repeated.",
};

const page = (title: string, body: string, status: number) =>
  new NextResponse(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;max-width:36rem;margin:3rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p><p><a href="/admin">Back to admin</a></p>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** Where an admin lands after approving Billie Bot's install in Slack: checks it, stores the token pair, says what happened. */
async function finishBotInstall(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user || auth.forbidden) return page("Admins only", "Only an admin can install the Slack bot.", 403);
  if (!isSlackConnectConfigured()) return page("Not configured", "SLACK_CLIENT_ID and SLACK_CLIENT_SECRET are not set.", 503);

  const params = request.nextUrl.searchParams;
  if (!(await consumeConnectStateCookie(params.get("state")))) return page("That link expired", "Start again from /api/oauth/slack/bot/start.", 400);
  const code = params.get("code");
  if (params.get("error") || !code) return page("Not approved", "Slack didn't get an approval, so nothing was stored.", 400);

  const result = await completeBotInstall(createServiceRoleClient(), code);
  if (!result.ok) return page("Billie Bot was not installed", BOT_INSTALL_PROBLEMS[result.reason], 400);
  return page("Billie Bot is installed", `Its new token is stored and refreshes itself (first expiry ${result.expiresAt.toISOString()}). Slack DMs, the Home tab and alerts work again.`, 200);
}
