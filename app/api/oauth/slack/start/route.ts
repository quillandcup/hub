import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { buildSlackAuthorizeUrl, isSlackConnectConfigured, setConnectStateCookie } from "@/lib/slack-connect";

/**
 * Starts "Connect your Slack account": sends the signed-in member to Slack to approve the Hub
 * acting as them. Their own account only (never in sudo), behind the chat_posting preview, and
 * only once the Slack app's client ID and secret are configured.
 */
export async function GET(request: NextRequest) {
  const back = (reason: string) => NextResponse.redirect(new URL(`/settings?slack=${reason}`, request.nextUrl.origin));

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  const identity = await getEffectiveIdentity(user);
  if (!identity) return back("no_member");
  if (identity.isSudo) return back("sudo");
  if (!isSlackConnectConfigured()) return back("unavailable");
  if (!(await effectiveMemberHasFeature("chat_posting", identity, await getUserFeaturePreviews(user.id)))) return back("unavailable");

  const state = await setConnectStateCookie();
  return NextResponse.redirect(buildSlackAuthorizeUrl(state));
}
