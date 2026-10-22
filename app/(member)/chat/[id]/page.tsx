import { CHAT_LIST_HREF } from "@/lib/chat/last-channel";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { catchUpChannel } from "@/lib/chat/gap-fill";
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
  loadMemberCard,
} from "@/lib/chat/load";
import AvatarStack from "@/components/AvatarStack";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import Composer from "@/components/chat/Composer";
import ThreadList from "@/components/chat/ThreadList";
import MessageList from "@/components/chat/MessageList";
import ChatLive from "@/components/chat/ChatLive";
import SidePanel from "@/components/chat/SidePanel";
import { ORG_TIMEZONE } from "@/lib/config";
import { getUserTimezonePreference } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/time-zone";
import ProfileCard from "@/components/chat/ProfileCard";

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
  const { user, identity } = await requireChat();
  const { id } = await params;
  const { before, thread, profile } = await searchParams;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const channel = await loadChannelForMember(supabase, id, identity.memberId, identity.isSudo);
  if (!channel) notFound();

  const sudoHidden = identity.isSudo && channel.restricted;

  // Opening a conversation catches it up with Slack after the page is sent: whatever the webhook never
  // delivered is fetched now, not at the nightly import (one fetch per conversation a minute, however
  // many members open it; recorded in chat_gap_fills). Not for an older page, and not in sudo.
  if (!sudoHidden && !identity.isSudo && !before && channel.slackChannelId) {
    const slackChannelId = channel.slackChannelId;
    after(async () => {
      try {
        await catchUpChannel(createServiceRoleClient(), { channelId: slackChannelId, source: "open" });
      } catch (error) {
        console.error("catching a conversation up with Slack failed:", error);
      }
    });
  }
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

  // Times are in the reader's zone; "browser" means not detected yet, so the organization's.
  const preferredZone = await getUserTimezonePreference();
  const timeZone = isValidTimeZone(preferredZone) ? preferredZone : ORG_TIMEZONE;

  const people = sudoHidden ? [] : await loadChannelMembers(supabase, channel.id);

  // Where the member had read up to when they opened this (the marker only moves when they leave,
  // so the line below stays put for the whole visit). Not in sudo (their marker isn't the viewed
  // member's) and not on an older page.
  let readMarker: string | null = null;
  if (!sudoHidden && !identity.isSudo && !before) {
    const { data } = await supabase
      .from("chat_channel_members")
      .select("last_read_at, joined_at")
      .eq("channel_id", channel.id)
      .eq("member_id", identity.memberId)
      .is("left_at", null)
      .maybeSingle();
    readMarker = data ? (data.last_read_at ?? data.joined_at) : null;
  }
  const mainRows = page?.messages ?? [];
  const threadRows = root ? [root, ...(threadPage?.messages ?? [])] : [];
  const [{ views, ...rendered }, channels, memberCard] = await Promise.all([
    buildMessageViews(supabase, channel, [...mainRows, ...threadRows], identity.memberId),
    loadChatChannels(supabase, identity.memberId, identity.isSudo),
    profileId && !threadId && !sudoHidden ? loadMemberCard(supabase, profileId) : Promise.resolve(null),
  ]);
  const ctx = chatTextContext(rendered, channels);
  const messageViews = views.slice(0, mainRows.length);
  const threadViews = views.slice(mainRows.length);
  const firstUnreadId = readMarker
    ? messageViews.find(
        (m) => m.contentState !== "deleted" && m.authorMemberId !== identity.memberId && Date.parse(m.createdAt) > Date.parse(readMarker!)
      )?.id
    : undefined;
  const rootView = root ? threadViews[0] : null;
  const replyViews = root ? threadViews.slice(1) : [];
  const panelOpen = !sudoHidden && (rootView !== null || (profileId !== null && !threadId));
  // Posting is its own preview on top of chat; never in sudo, in a conversation the member is not in
  // or an archived one (chat_post_message checks the same again, and that the conversation is bridged).
  const postingOn =
    !sudoHidden &&
    !identity.isSudo &&
    !channel.archived &&
    (await effectiveMemberHasFeature("chat_posting", identity, await getUserFeaturePreviews(user.id)));
  const canPost = postingOn && channel.joined;
  // Reacting also works in a public channel the member has not joined.
  const canReact = postingOn;
  // Who the composer shows as the author of a message while it is sent.
  const me = people.find((p) => p.memberId === identity.memberId);
  const viewer = { memberId: identity.memberId, name: me?.name ?? identity.memberName, photoUrl: me?.photoUrl ?? null };
  const closeHref = `/chat/${channel.id}${before && !Array.isArray(before) ? `?before=${encodeURIComponent(before)}` : ""}`;

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 flex items-start justify-between gap-4 border-b border-slate-200 px-6 pb-3 pt-5 dark:border-slate-800">
          <div>
            <Link data-track="chat-channel-channels" href={CHAT_LIST_HREF} className="mb-1 inline-block text-sm text-plum-600 hover:underline @split:hidden dark:text-plum-400">
              ← Channels
            </Link>
            <h1 className="text-2xl font-bold">{channel.label}</h1>
            {channel.archived && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">This channel is archived in Slack.</p>
            )}
          </div>
          {people.length > 0 && (
            <Link data-track="chat-channel-members"
              href={`/chat/${channel.id}/members`}
              aria-label={`${people.length} ${people.length === 1 ? "member" : "members"}`}
              className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <AvatarStack people={people} size={24} max={3} />
              <span>{people.length}</span>
            </Link>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
          {sudoHidden ? (
            <p className="py-3 text-sm text-slate-600 dark:text-slate-400">
              This conversation is restricted, so its messages are hidden while you view as a member.
            </p>
          ) : (
            <section aria-label="Messages">
              <ChatLive
                channelId={channel.id}
                view={before ? "older" : "latest"}
                markRead={!identity.isSudo}
                latestAt={messageViews.length > 0 ? messageViews[messageViews.length - 1].createdAt : null}
                latestId={messageViews.length > 0 ? messageViews[messageViews.length - 1].id : null}
              />
              <MessageList
                key={`${channel.id}:${before ?? ""}`}
                channelId={channel.id}
                views={messageViews}
                ctx={ctx}
                olderBefore={page?.olderBefore ?? null}
                firstUnreadId={firstUnreadId}
                canReact={canReact}
                showSent={!before}
                timeZone={timeZone}
              />
            </section>
          )}
        </div>
        {canPost && (
          <Composer channelId={channel.id} placeholder={`Message ${channel.label}`} viewer={viewer} showSent={!before} />
        )}
      </div>

      {panelOpen && rootView && (
        <SidePanel title="Thread" closeHref={closeHref}>
          <ChatLive
            channelId={channel.id}
            view="thread"
            threadRootId={threadId}
            latestId={threadViews[threadViews.length - 1].id}
          />
          <ThreadList
            key={rootView.id}
            channelId={channel.id}
            threadRootId={rootView.id}
            root={rootView}
            replies={replyViews}
            ctx={ctx}
            canReact={canReact}
            timeZone={timeZone}
          />
          {canPost && rootView.syncStatus === null && (
            <Composer channelId={channel.id} threadRootId={rootView.id} placeholder="Reply…" viewer={viewer} showSent />
          )}
        </SidePanel>
      )}
      {panelOpen && !rootView && profileId && (
        <SidePanel title="Profile" closeHref={closeHref}>
          {memberCard ? <ProfileCard member={memberCard} /> : <p className="py-6 text-sm text-slate-500">This member isn&apos;t available.</p>}
        </SidePanel>
      )}
    </div>
  );
}
