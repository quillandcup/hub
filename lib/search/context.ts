import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { loadChatChannels } from "@/lib/chat/load";
import type { SearchContext } from "@/lib/search/universal";
import type { SearchKind } from "@/lib/search/syntax";

export interface Searcher {
  ctx: SearchContext;
  /** Kinds this viewer can't search (chat without the chat feature). */
  skip: SearchKind[];
  /** The real signed-in user is an admin (sudo or not): offers the admin-only operators' chips. */
  isAdmin: boolean;
}

/**
 * Who is searching and what they may search, or null when universal search is off for them (not
 * signed in, or without the `universal_search` flag on their own account). The search runs on the
 * caller's own Supabase client, so RLS is the real gate; this decides scope and links: staff
 * results (email, status, /admin links) only for an admin who is not acting as a member.
 */
export async function getSearcher(): Promise<Searcher | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const features = await getUserFeaturePreviews(user.id);
  if (!features.includes("universal_search")) return null;

  const supabase = await createClient();
  const [{ data: profile }, identity] = await Promise.all([
    supabase.from("user_profiles").select("role").eq("id", user.id).single(),
    getEffectiveIdentity(user),
  ]);
  const isAdmin = profile?.role === "admin";
  const isSudo = identity?.isSudo ?? false;

  // Chat follows the viewed member's own chat flag, like the chat pages (lib/chat/access.ts).
  const chatOn = identity ? await effectiveMemberHasFeature("chat", identity, features) : false;
  const channels = chatOn && identity ? await loadChatChannels(supabase, identity.memberId, isSudo) : [];
  const chatChannels = channels.filter((c) => !(isSudo && c.restricted));

  return {
    ctx: {
      supabase,
      viewerMemberId: identity?.memberId ?? null,
      isActingAsAdmin: isAdmin && !isSudo,
      chatChannels,
    },
    skip: chatOn ? [] : ["chat"],
    isAdmin,
  };
}
