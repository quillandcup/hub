import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { loadChatChannels, type ChannelSummary } from "@/lib/chat/load";
import type { SearchContext } from "@/lib/search/universal";
import type { SearchKind } from "@/lib/search/syntax";

export interface Searcher {
  ctx: SearchContext;
  /** Kinds this viewer can't search (chat without the chat feature). */
  skip: SearchKind[];
  /** The real signed-in user is an admin (sudo or not): offers the admin-only operators' chips. */
  isAdmin: boolean;
  /** An admin is browsing as a member: their own inbox and unread counts are not the member's to show. */
  isSudo: boolean;
}

/**
 * Who is searching and what they may search, or null when not signed in. The search runs on the
 * caller's own Supabase client, so RLS is the real gate; this decides scope and links: staff
 * results (email, status, /admin links) only for an admin who is not acting as a member.
 */
export async function getSearcher(): Promise<Searcher | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  // Every lookup that doesn't depend on another runs together: this is on the path of each keystroke.
  const supabase = await createClient();
  const [features, { data: profile }, identity] = await Promise.all([
    getUserFeaturePreviews(user.id),
    supabase.from("user_profiles").select("role").eq("id", user.id).single(),
    getEffectiveIdentity(user),
  ]);
  const isAdmin = profile?.role === "admin";
  const isSudo = identity?.isSudo ?? false;

  // Chat follows the viewed member's own chat flag, like the chat pages (lib/chat/access.ts).
  const chatOn = identity ? await effectiveMemberHasFeature("chat", identity, features) : false;
  // Loaded only if chat is searched (see SearchContext.chatChannels), once per search.
  let channels: Promise<ChannelSummary[]> | undefined;
  const chatChannels = () =>
    (channels ??= loadChatChannels(supabase, identity!.memberId, isSudo).then((all) => all.filter((c) => !(isSudo && c.restricted))));

  return {
    ctx: {
      supabase,
      viewerMemberId: identity?.memberId ?? null,
      isActingAsAdmin: isAdmin && !isSudo,
      chatChannels: chatOn && identity ? chatChannels : [],
      features: chatOn ? [...features, "chat"] : features,
    },
    skip: chatOn ? [] : ["chat", "channels"],
    isAdmin,
    isSudo,
  };
}
