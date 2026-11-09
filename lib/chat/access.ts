import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { getSlackConnectionStatus, isSlackConnectConfigured } from "@/lib/slack-connect";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * The gate every chat page (and the chat layout) starts with: signed in, has a member record
 * (the sudo'd member's, in sudo), and they have connected Slack (otherwise they are sent to
 * Settings to do it). Memoized per render.
 */
export const requireChat = cache(async (): Promise<{ user: AuthUser; identity: EffectiveIdentity }> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const identity = await getEffectiveIdentity(user);
  if (!identity) redirect("/admin");
  // Chat is for members who connected Slack (with every scope read sync needs): that link is what
  // attributes their messages and what lets the Hub act as them. Sudo has none to check; it is
  // read-only. Off until the Slack app is configured, so a missing env var never locks everyone out.
  if (!identity.isSudo && isSlackConnectConfigured()) {
    const slack = await getSlackConnectionStatus(createServiceRoleClient(), identity.memberId);
    if (!slack.sharesReadState) redirect("/settings?slack=required");
  }
  return { user, identity };
});
