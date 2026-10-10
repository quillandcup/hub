import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireChat } from "@/lib/chat/access";
import { isUuid, parseBefore } from "@/lib/chat/format";
import {
  buildMessageViews,
  chatTextContext,
  loadChannelForMember,
  loadChannelMembers,
  loadChatChannels,
  loadMessage,
  loadMessages,
} from "@/lib/chat/load";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import MessageItem from "@/components/chat/MessageItem";

export const metadata: Metadata = {
  title: "Chat",
};

type Param = string | string[] | undefined;

/**
 * One conversation, read-only: the newest messages (?before= for older ones) or one thread
 * (?thread=<message id>). What the member can read is decided by RLS on the chat_* tables;
 * this page scopes it to their own conversations and, in sudo, hides group messages and
 * restricted conversations the way the member's private notes are hidden.
 */
export default async function ChatChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: Param; thread?: Param }>;
}) {
  const { identity } = await requireChat();
  const { id } = await params;
  const { before, thread } = await searchParams;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const channel = await loadChannelForMember(supabase, id, identity.memberId, identity.isSudo);
  if (!channel) notFound();

  const sudoHidden = identity.isSudo && channel.restricted;
  const threadId = Array.isArray(thread) ? thread[0] : thread;
  if (threadId !== undefined && !isUuid(threadId)) notFound();

  let root = null;
  let page = null;
  if (!sudoHidden) {
    if (threadId) {
      root = await loadMessage(supabase, channel.id, threadId);
      if (!root) notFound();
      page = await loadMessages(supabase, channel.id, { threadRootId: threadId });
    } else {
      page = await loadMessages(supabase, channel.id, { before: parseBefore(before) });
    }
  }

  const people = sudoHidden ? [] : await loadChannelMembers(supabase, channel.id);
  const rows = page ? (root ? [root, ...page.messages] : page.messages) : [];
  const [{ views, ...rendered }, channels] = await Promise.all([
    buildMessageViews(supabase, channel, rows, identity.memberId),
    loadChatChannels(supabase, identity.memberId, identity.isSudo),
  ]);
  const ctx = chatTextContext(rendered, channels);
  const rootView = root ? views[0] : null;
  const messageViews = root ? views.slice(1) : views;

  return (
    <div>
      <header className="mb-4 pb-3 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{channel.label}</h1>
          {channel.archived && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">This channel is archived in Slack.</p>
          )}
        </div>
        {people.length > 0 && (
          <Link
            href={`/chat/${channel.id}/members`}
            aria-label={`${people.length} ${people.length === 1 ? "member" : "members"}`}
            className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span className="flex -space-x-2" aria-hidden="true">
              {people.slice(0, 3).map((p) => (
                <span key={p.memberId} className="rounded-full ring-2 ring-white dark:ring-slate-900">
                  <MemberAvatar name={p.name} photoUrl={p.photoUrl} size={24} />
                </span>
              ))}
            </span>
            <span>{people.length}</span>
          </Link>
        )}
      </header>

      {sudoHidden ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          This conversation is restricted, so its messages are hidden while you view as a member.
        </p>
      ) : rootView ? (
        <section aria-label="Thread">
          <Link href={`/chat/${channel.id}`} className="text-sm text-plum-600 dark:text-plum-400 hover:underline">
            ← Back to {channel.label}
          </Link>
          <MessageItem message={rootView} ctx={ctx} channelId={channel.id} inThread />
          <div className="ml-4 pl-4 border-l-2 border-slate-200 dark:border-slate-700">
            {messageViews.length === 0 && <p className="py-3 text-sm text-slate-500">No replies yet.</p>}
            {messageViews.map((m) => (
              <MessageItem key={m.id} message={m} ctx={ctx} channelId={channel.id} inThread />
            ))}
          </div>
        </section>
      ) : (
        <section aria-label="Messages">
          {page?.olderBefore && (
            <Link
              href={`/chat/${channel.id}?before=${encodeURIComponent(page.olderBefore)}`}
              className="inline-block mb-2 text-sm text-plum-600 dark:text-plum-400 hover:underline"
            >
              Load older messages
            </Link>
          )}
          {messageViews.length === 0 && <p className="py-3 text-sm text-slate-500">No messages here yet.</p>}
          {messageViews.map((m) => (
            <MessageItem key={m.id} message={m} ctx={ctx} channelId={channel.id} />
          ))}
        </section>
      )}
    </div>
  );
}
