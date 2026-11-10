import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import { requireChat } from "@/lib/chat/access";
import { loadUnreadCounts } from "@/lib/chat/load";
import { loadChatChannelsForRender } from "@/lib/chat/render-data";
import { canStartDirectMessage } from "@/lib/chat/can-message";
import { getUserFeaturePreviews } from "@/lib/features.server";
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
  const canStartDm = canStartDirectMessage(identity, await getUserFeaturePreviews(user.id));
  const [channels, unread, drafts] = await Promise.all([
    loadChatChannelsForRender(identity.memberId, identity.isSudo),
    identity.isSudo ? Promise.resolve({}) : loadUnreadCounts(supabase),
    // Unsent text, for the sidebar's Drafts list; a failed read just shows none. Not in sudo (not the viewed member's).
    identity.isSudo ? Promise.resolve([]) : createRepos(supabase).chatDrafts.list(identity.memberId).catch(() => []),
  ]);

  return (
    <div className="@container h-full min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 flex-col @split:flex-row">
        <ChatSidebar canStartDm={canStartDm} channels={channels} unread={unread} drafts={drafts.map((d) => ({ channelId: d.channelId, threadRootId: d.threadRootId, body: d.body, fileCount: d.files.length }))} selfMemberId={identity.isSudo ? null : identity.memberId} />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
