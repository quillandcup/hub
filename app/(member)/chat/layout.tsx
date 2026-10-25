import { createClient } from "@/lib/supabase/server";
import { requireChat } from "@/lib/chat/access";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { loadUnreadCounts } from "@/lib/chat/load";
import { loadChatChannelsForRender } from "@/lib/chat/render-data";
import ChatSidebar from "@/components/chat/ChatSidebar";

/**
 * Chat shell, laid out like Slack: the member's conversations pinned on the left, and whatever
 * is open filling the rest of the height. Each pane scrolls on its own (the conversation page
 * splits its area into messages and an optional right panel); pages that are plain documents
 * (search, members) scroll within the area and pad themselves. Behind the `chat` feature
 * (requireChat); each page repeats the check because layouts don't re-run on client navigation.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const { user, identity } = await requireChat();
  const supabase = await createClient();
  // Unread counts follow the signed-in member's read markers, which are not the viewed member's in
  // sudo (read-only), so sudo shows none.
  const [channels, unread, showPrivacy] = await Promise.all([
    loadChatChannelsForRender(identity.memberId, identity.isSudo),
    identity.isSudo ? Promise.resolve({}) : loadUnreadCounts(supabase),
    // The link is only worth showing once the page is on for them (it redirects otherwise).
    getUserFeaturePreviews(user.id).then((own) => effectiveMemberHasFeature("message_privacy", identity, own)),
  ]);

  return (
    <div className="@container h-full">
      <div className="flex h-full flex-col @split:flex-row">
        <ChatSidebar channels={channels} unread={unread} selfMemberId={identity.isSudo ? null : identity.memberId} showPrivacy={showPrivacy} />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
