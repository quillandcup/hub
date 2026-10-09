import { createClient } from "@/lib/supabase/server";
import { requireChat } from "@/lib/chat/access";
import { loadChatChannels } from "@/lib/chat/load";
import ChatSidebar from "@/components/chat/ChatSidebar";

/**
 * Chat shell: the member's conversations beside whatever is open. Behind the `chat` feature
 * (requireChat); each page repeats the check because layouts don't re-run on client navigation.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const { identity } = await requireChat();
  const channels = await loadChatChannels(await createClient(), identity.memberId, identity.isSudo);

  return (
    <div className="container mx-auto px-6 py-6 max-w-6xl">
      <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
        <ChatSidebar channels={channels} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
