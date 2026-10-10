import type { Metadata } from "next";
import { requireChat } from "@/lib/chat/access";

export const metadata: Metadata = {
  title: "Chat",
};

/** /chat: nothing open yet; the conversations are in the sidebar (chat/layout.tsx). */
export default async function ChatPage() {
  await requireChat();
  return (
    <div className="p-6 max-md:hidden">
      <h1 className="text-2xl font-bold mb-2">Chat</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-prose">
        A read-only view of our Slack conversations, kept here for good. Pick one on the left. Posting still happens in
        Slack for now.
      </p>
    </div>
  );
}
