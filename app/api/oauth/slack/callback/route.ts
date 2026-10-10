import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  consumeConnectStateCookie,
  exchangeSlackCode,
  isSlackConnectConfigured,
  saveSlackConnection,
  slackUserIsMember,
} from "@/lib/slack-connect";

/**
 * Where Slack sends the member back after they approve (or refuse). This exact path is the redirect
 * URL registered in slack-app-manifest.yml. Checks the flow started in this browser (state cookie),
 * that the signed-in member is the one connecting (not in sudo), and that the Slack account that
 * approved is theirs, then stores the user token in Vault.
 */
export async function GET(request: NextRequest) {
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
    if (!(await slackUserIsMember(service, grant.slackUserId, identity.memberId, user.id))) return back("wrong_account");
    await saveSlackConnection(service, identity.memberId, grant);
    return back("connected");
  } catch (error) {
    console.error("Slack connect failed:", error);
    return back("failed");
  }
}
