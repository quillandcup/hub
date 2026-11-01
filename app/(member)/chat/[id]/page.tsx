import { CHAT_LIST_HREF } from "@/lib/chat/last-channel";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { catchUpChannel } from "@/lib/chat/gap-fill";
import { requireChat } from "@/lib/chat/access";
import { parseBefore } from "@/lib/chat/format";
import { isId } from "@/lib/ids";
import { createStageTimer } from "@/lib/chat/timing";
import { loadChatChannelsForRender } from "@/lib/chat/render-data";
import { firstUnreadMessageId } from "@/lib/chat/unread";
import {
  buildMessageViews,
  chatTextContext,
  loadChannelForMember,
  loadChannelMembers,
  loadMessage,
  loadMessages,
  loadMemberCard,
} from "@/lib/chat/load";
import AvatarStack from "@/components/AvatarStack";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import Composer from "@/components/chat/Composer";
import JoinPrompt from "@/components/chat/JoinPrompt";
import ThreadList from "@/components/chat/ThreadList";
import MessageList from "@/components/chat/MessageList";
import ChatLive from "@/components/chat/ChatLive";
import SidePanel from "@/components/chat/SidePanel";
import { ORG_TIMEZONE } from "@/lib/config";
import { getUserTimezonePreference } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/time-zone";
import ProfileCard from "@/components/chat/ProfileCard";

// generateMetadata and the page both need the channel; keyed on plain values (not the client) so one request reads it once.
const channelFor = cache(async (id: string, memberId: string, isSudo: boolean) =>
  loadChannelForMember(await createClient(), id, memberId, isSudo)
);

// The tab is titled with the conversation (channel, group or DM), most specific first.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isId(id, "chn")) return { title: "Chat" };
  const { identity } = await requireChat();
  const channel = await channelFor(id, identity.memberId, identity.isSudo);
  return { title: channel ? `${channel.label} · Chat` : "Chat" };
}

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
  const timer = createStageTimer();
  const { user, identity } = await requireChat();
  timer.mark("requireChat");
  const { id } = await params;
  const { before, thread, profile } = await searchParams;
  if (!isId(id, "chn")) notFound();

  const supabase = await createClient();
  const channel = await channelFor(id, identity.memberId, identity.isSudo);
  if (!channel) notFound();
  timer.mark("channel");

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
  if (threadId !== undefined && !isId(threadId, "msg")) notFound();
  const profileParam = Array.isArray(profile) ? profile[0] : profile;
  const profileId = profileParam && isId(profileParam, "mbr") ? profileParam : null;

  // Everything below is independent of everything else except the message views, so it is read at
  // once: a conversation switch waits for the slowest query, not the sum of them.
  const readMarkerQuery = async (): Promise<string | null> => {
    // Where the member had read up to when they opened this (the marker only moves when they leave,
    // so the line below stays put for the whole visit). Not in sudo (their marker isn't the viewed
    // member's) and not on an older page.
    if (sudoHidden || identity.isSudo || before) return null;
    // A failed read shows no marker, as it always has.
    return createRepos(supabase).chat.readMarker(channel.id, identity.memberId).catch(() => null);
  };
  // Posting is its own preview on top of chat; never in sudo, in a conversation the member is not in
  // or an archived one (chat_post_message checks the same again, and that the conversation is bridged).
  const postingQuery = async (): Promise<boolean> => {
    if (sudoHidden || identity.isSudo || channel.archived) return false;
    return effectiveMemberHasFeature("chat_posting", identity, await getUserFeaturePreviews(user.id));
  };
  // The conversation always shows its messages; a thread or a profile opens beside it.
  const messagesQuery = async () => {
    if (sudoHidden) return { page: null, root: null, threadPage: null };
    const [page, thread] = await Promise.all([
      loadMessages(supabase, channel.id, { before: parseBefore(before) }),
      threadId
        ? Promise.all([loadMessage(supabase, channel.id, threadId), loadMessages(supabase, channel.id, { threadRootId: threadId })])
        : Promise.resolve(null),
    ]);
    if (thread && !thread[0]) notFound();
    return { page, root: thread?.[0] ?? null, threadPage: thread?.[1] ?? null };
  };
  const [{ page, root, threadPage }, preferredZone, people, readMarker, channels, memberCard, postingOn] = await Promise.all([
    timer.time("messages", messagesQuery()),
    // Times are in the reader's zone; "browser" means not detected yet, so the organization's.
    timer.time("timezone", getUserTimezonePreference()),
    sudoHidden ? Promise.resolve([]) : timer.time("members", loadChannelMembers(supabase, channel.id)),
    timer.time("readMarker", readMarkerQuery()),
    timer.time("channels", loadChatChannelsForRender(identity.memberId, identity.isSudo)),
    profileId && !threadId && !sudoHidden ? loadMemberCard(supabase, profileId) : Promise.resolve(null),
    timer.time("posting", postingQuery()),
  ]);
  timer.mark("parallel");
  const timeZone = isValidTimeZone(preferredZone) ? preferredZone : ORG_TIMEZONE;
  const mainRows = page?.messages ?? [];
  const threadRows = root ? [root, ...(threadPage?.messages ?? [])] : [];
  const { views, ...rendered } = await buildMessageViews(supabase, channel, [...mainRows, ...threadRows], identity.memberId, timer);
  const ctx = chatTextContext(rendered, channels);
  timer.log(channel.kind === "channel" ? "channel" : "group");
  const messageViews = views.slice(0, mainRows.length);
  const threadViews = views.slice(mainRows.length);
  const firstUnreadId = firstUnreadMessageId(messageViews, readMarker);
  const rootView = root ? threadViews[0] : null;
  const replyViews = root ? threadViews.slice(1) : [];
  const panelOpen = !sudoHidden && (rootView !== null || (profileId !== null && !threadId));
  const canPost = postingOn && channel.joined;
  // Reacting also works in a public channel the member has not joined.
  const canReact = postingOn;
  // Who the composer shows as the author of a message while it is sent.
  const me = people.find((p) => p.memberId === identity.memberId);
  const viewer = { memberId: identity.memberId, name: me?.name ?? identity.memberDisplayName ?? identity.memberName, photoUrl: me?.photoUrl ?? null };
  const renderedAt = new Date().toISOString();
  const closeHref = `/chat/${channel.id}${before && !Array.isArray(before) ? `?before=${encodeURIComponent(before)}` : ""}`;

  return (
    <div className="relative flex h-full min-h-0">
      <div id="chat-conversation" className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 flex items-start justify-between gap-4 border-b border-slate-200 px-6 pb-3 pt-5 dark:border-slate-800">
          <div>
            <Link data-track="chat-channel-channels" href={CHAT_LIST_HREF} className="mb-1 inline-block text-sm text-plum-600 hover:underline @split:hidden dark:text-plum-400">
              ← Channels
            </Link>
            <h1 className="text-2xl font-bold">{channel.label}</h1>
            {channel.archived && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">This channel is archived in Slack.</p>
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
                renderedAt={renderedAt}
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
          <Composer channelId={channel.id} placeholder={`Message ${channel.label}`} viewer={viewer} showSent={!before} dropTargetIds={["chat-conversation", "chat-profile-panel"]} />
        )}
        {postingOn && !channel.joined && channel.kind === "channel" && channel.visibility === "public" && (
          <JoinPrompt channelId={channel.id} channelLabel={channel.label} />
        )}
      </div>

      {panelOpen && rootView && (
        <SidePanel id="chat-thread-panel" title="Thread" closeHref={closeHref}>
          <ChatLive
            channelId={channel.id}
            view="thread"
            threadRootId={threadId}
            renderedAt={renderedAt}
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
            <Composer channelId={channel.id} threadRootId={rootView.id} placeholder="Reply…" viewer={viewer} showSent dropTargetIds={["chat-thread-panel"]} />
          )}
        </SidePanel>
      )}
      {panelOpen && !rootView && profileId && (
        <SidePanel id="chat-profile-panel" title="Profile" closeHref={closeHref}>
          {memberCard ? <ProfileCard member={memberCard} /> : <p className="py-6 text-sm text-slate-600 dark:text-slate-400">This member isn&apos;t available.</p>}
        </SidePanel>
      )}
    </div>
  );
}
