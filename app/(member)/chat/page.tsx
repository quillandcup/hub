import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireChat } from "@/lib/chat/access";
import { firstParam, isUuid } from "@/lib/chat/format";
import { LAST_CHAT_COOKIE } from "@/lib/chat/last-channel";
import { loadChannelForMember } from "@/lib/chat/load";

export const metadata: Metadata = {
  title: "Chat",
};

/**
 * /chat reopens the conversation the member last had open (the sidebar remembers it in a cookie),
 * as long as they can still read it. ?list=1 skips that and shows the list, which on a narrow
 * screen is the home screen; otherwise nothing is open yet and the conversations are in the
 * sidebar (chat/layout.tsx).
 */
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ list?: string | string[] }> }) {
  const { identity } = await requireChat();
  const { list } = await searchParams;
  const last = (await cookies()).get(LAST_CHAT_COOKIE)?.value;
  if (!firstParam(list) && isUuid(last)) {
    const channel = await loadChannelForMember(await createClient(), last, identity.memberId, identity.isSudo);
    if (channel) redirect(`/chat/${channel.id}`);
  }
  return (
    <div className="hidden p-6 @split:block">
      <h1 className="text-2xl font-bold mb-2">Chat</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-prose">
        A read-only view of our Slack conversations, kept here for good. Pick one on the left. Posting still happens in
        Slack for now.
      </p>
    </div>
  );
}
