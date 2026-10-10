import { createClient } from "@/lib/supabase/server";
import { requireChat } from "@/lib/chat/access";
import { loadChatChannels } from "@/lib/chat/load";
import ChatSidebar from "@/components/chat/ChatSidebar";

/**
 * Chat shell, laid out like Slack: the member's conversations pinned on the left, and whatever
 * is open filling the rest of the height. Each pane scrolls on its own (the conversation page
 * splits its area into messages and an optional right panel); pages that are plain documents
 * (search, members) scroll within the area and pad themselves. Behind the `chat` feature
 * (requireChat); each page repeats the check because layouts don't re-run on client navigation.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const { identity } = await requireChat();
  const channels = await loadChatChannels(await createClient(), identity.memberId, identity.isSudo);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <ChatSidebar channels={channels} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
