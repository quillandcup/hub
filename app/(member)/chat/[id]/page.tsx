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
  memberProfiles,
} from "@/lib/chat/load";
import AvatarStack from "@/components/AvatarStack";
import MessageItem from "@/components/chat/MessageItem";
import ChatLive from "@/components/chat/ChatLive";
import SidePanel from "@/components/chat/SidePanel";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";

export const metadata: Metadata = {
  title: "Chat",
};

type Param = string | string[] | undefined;

/**
 * One conversation, read-only, laid out like Slack: its messages scroll in the middle (?before= for
 * older ones) and a thread (?thread=<message id>) or a member's profile (?profile=<member id>) opens
 * in a panel on the right. What the member can read is decided by RLS on the chat_* tables;
 * this page scopes it to their own conversations and, in sudo, hides group messages and
 * restricted conversations the way the member's private notes are hidden.
 */
export default async function ChatChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: Param; thread?: Param; profile?: Param }>;
}) {
  const { identity } = await requireChat();
  const { id } = await params;
  const { before, thread, profile } = await searchParams;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const channel = await loadChannelForMember(supabase, id, identity.memberId, identity.isSudo);
  if (!channel) notFound();

  const sudoHidden = identity.isSudo && channel.restricted;
  const threadId = Array.isArray(thread) ? thread[0] : thread;
  if (threadId !== undefined && !isUuid(threadId)) notFound();
  const profileParam = Array.isArray(profile) ? profile[0] : profile;
  const profileId = profileParam && isUuid(profileParam) ? profileParam : null;

  // The conversation always shows its messages; a thread or a profile opens beside it.
  let root = null;
  let threadPage = null;
  let page = null;
  if (!sudoHidden) {
    page = await loadMessages(supabase, channel.id, { before: parseBefore(before) });
    if (threadId) {
      root = await loadMessage(supabase, channel.id, threadId);
      if (!root) notFound();
      threadPage = await loadMessages(supabase, channel.id, { threadRootId: threadId });
    }
  }

  const people = sudoHidden ? [] : await loadChannelMembers(supabase, channel.id);
  const mainRows = page?.messages ?? [];
  const threadRows = root ? [root, ...(threadPage?.messages ?? [])] : [];
  const [{ views, ...rendered }, channels, profileCard] = await Promise.all([
    buildMessageViews(supabase, channel, [...mainRows, ...threadRows], identity.memberId),
    loadChatChannels(supabase, identity.memberId, identity.isSudo),
    profileId && !threadId && !sudoHidden ? memberProfiles(supabase, [profileId]) : Promise.resolve(null),
  ]);
  const ctx = chatTextContext(rendered, channels);
  const messageViews = views.slice(0, mainRows.length);
  const threadViews = views.slice(mainRows.length);
  const rootView = root ? threadViews[0] : null;
  const replyViews = root ? threadViews.slice(1) : [];
  const profilePerson = profileId && profileCard ? profileCard.get(profileId) : undefined;
  const panelOpen = !sudoHidden && (rootView !== null || (profileId !== null && !threadId));
  const closeHref = `/chat/${channel.id}${before && !Array.isArray(before) ? `?before=${encodeURIComponent(before)}` : ""}`;

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 flex items-start justify-between gap-4 border-b border-slate-200 px-6 pb-3 pt-5 dark:border-slate-800">
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
              <AvatarStack people={people} size={24} max={3} />
              <span>{people.length}</span>
            </Link>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
          {sudoHidden ? (
            <p className="py-3 text-sm text-slate-600 dark:text-slate-400">
              This conversation is restricted, so its messages are hidden while you view as a member.
            </p>
          ) : (
            <section aria-label="Messages">
              <ChatLive
                channelId={channel.id}
                view={before ? "older" : "latest"}
                messageIds={messageViews.map((m) => m.id)}
                latestId={messageViews.length > 0 ? messageViews[messageViews.length - 1].id : null}
              />
              {page?.olderBefore && (
                <Link
                  href={`/chat/${channel.id}?before=${encodeURIComponent(page.olderBefore)}`}
                  scroll={false}
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
      </div>

      {panelOpen && rootView && (
        <SidePanel title="Thread" closeHref={closeHref}>
          <ChatLive
            channelId={channel.id}
            view="thread"
            threadRootId={threadId}
            messageIds={threadViews.map((m) => m.id)}
            latestId={threadViews[threadViews.length - 1].id}
          />
          <MessageItem message={rootView} ctx={ctx} channelId={channel.id} inThread />
          <div className="ml-4 pl-4 border-l-2 border-slate-200 dark:border-slate-700">
            {replyViews.length === 0 && <p className="py-3 text-sm text-slate-500">No replies yet.</p>}
            {replyViews.map((m) => (
              <MessageItem key={m.id} message={m} ctx={ctx} channelId={channel.id} inThread />
            ))}
          </div>
        </SidePanel>
      )}
      {panelOpen && !rootView && profileId && (
        <SidePanel title="Profile" closeHref={closeHref}>
          {profilePerson ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <MemberAvatar name={profilePerson.name} photoUrl={profilePerson.photoUrl} size={96} />
              <p className="text-lg font-semibold">{profilePerson.name}</p>
              <Link
                href={`/members/${profileId}`}
                className="text-sm text-plum-600 dark:text-plum-400 hover:underline"
              >
                View full profile
              </Link>
            </div>
          ) : (
            <p className="py-6 text-sm text-slate-500">This member isn&apos;t available.</p>
          )}
        </SidePanel>
      )}
    </div>
  );
}
