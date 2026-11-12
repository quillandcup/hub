import { resolveFocus } from "@/lib/chat/focus";
import { CHAT_LIST_HREF } from "@/lib/chat/last-channel";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { createRepos } from "@/lib/data/repos";
import { withPreviewUrls } from "@/lib/chat/draft-files";
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
  staffDmReaderCheck,
  loadMessage,
  loadMessages,
  loadMemberCard,
} from "@/lib/chat/load";
import AvatarStack from "@/components/AvatarStack";
import StaffDmNotice from "@/components/chat/StaffDmNotice";
import Composer from "@/components/chat/Composer";
import JoinPrompt from "@/components/chat/JoinPrompt";
import ThreadList from "@/components/chat/ThreadList";
import MessageList from "@/components/chat/MessageList";
import ChatLive from "@/components/chat/ChatLive";
import SidePanel from "@/components/chat/SidePanel";
import NotifySetting from "@/components/chat/NotifySetting";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { ORG_TIMEZONE } from "@/lib/config";
import { getUserTimezonePreference } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/time-zone";
import ProfileCard from "@/components/chat/ProfileCard";

// generateMetadata and the page both need the channel; keyed on plain values (not the client) so one request reads it once.
const channelFor = cache(async (id: string, memberId: string, isSudo: boolean, userId: string) => {
  const repos = createRepos(await createClient());
  // A staff reader may open a direct message with a staff member in it, and every viewer is told when one has (the notice).
  return loadChannelForMember(repos, id, memberId, isSudo, { staffNotice: true, isStaffReader: staffDmReaderCheck(repos, userId) });
});

// The tab is titled with the conversation (channel, group or DM), most specific first.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isId(id, "chn")) return { title: "Chat" };
  const { user, identity } = await requireChat();
  const channel = await channelFor(id, identity.memberId, identity.isSudo, user.id);
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
  searchParams: Promise<{ before?: Param; thread?: Param; profile?: Param; m?: Param }>;
}) {
  const timer = createStageTimer();
  const { user, identity } = await requireChat();
  timer.mark("requireChat");
  const { id } = await params;
  const { before, thread, profile, m } = await searchParams;
  if (!isId(id, "chn")) notFound();

  const supabase = await createClient();
  const channel = await channelFor(id, identity.memberId, identity.isSudo, user.id);
  if (!channel) notFound();
  timer.mark("channel");

  const sudoHidden = identity.isSudo && channel.restricted;
  // An admin or community manager reading a direct message with a staff member in it that they are not in: read-only, and on record.
  // The entry is written before a word is shown, and a failure to write it stops the page: no reading without a trail.
  const staffRead = Boolean(channel.staffRead) && !sudoHidden;
  if (staffRead) await createRepos(supabase).chat.logStaffRead(channel.id);

  // Opening a conversation catches it up with Slack after the page is sent: whatever the webhook never
  // delivered is fetched now, not at the nightly import (one fetch per conversation a minute, however
  // many members open it; recorded in chat_gap_fills). Not for an older page, and not in sudo.
  if (!sudoHidden && !staffRead && !identity.isSudo && !before && channel.slackChannelId) {
    const slackChannelId = channel.slackChannelId;
    after(async () => {
      try {
        await catchUpChannel(createServiceRoleClient(), { channelId: slackChannelId, source: "open" });
      } catch (error) {
        console.error("catching a conversation up with Slack failed:", error);
      }
    });
  }
  const explicitThreadId = Array.isArray(thread) ? thread[0] : thread;
  if (explicitThreadId !== undefined && !isId(explicitThreadId, "msg")) notFound();
  // A `?m=<message id>` permalink (the message's own link, which survives sign-in): the conversation scrolls to that message, and a reply
  // opens its thread. Not in a restricted conversation hidden in sudo, and a message that isn't there is just the conversation.
  const focusParam = Array.isArray(m) ? m[0] : m;
  if (focusParam !== undefined && !isId(focusParam, "msg")) notFound();
  const focus = focusParam && !sudoHidden ? await resolveFocus(createRepos(supabase), channel.id, focusParam) : null;
  const threadId = explicitThreadId ?? focus?.threadRootId ?? undefined;
  // The main list scrolls to a top-level message; a reply is scrolled to inside its thread.
  const listFocusId = focus && !focus.threadRootId ? focus.id : null;
  const threadFocusId = focus?.threadRootId ? focus.id : null;
  const profileParam = Array.isArray(profile) ? profile[0] : profile;
  const profileId = profileParam && isId(profileParam, "mbr") ? profileParam : null;

  // Everything below is independent of everything else except the message views, so it is read at
  // once: a conversation switch waits for the slowest query, not the sum of them.
  const readMarkerQuery = async (): Promise<string | null> => {
    // Where the member had read up to when they opened this (the marker only moves when they leave,
    // so the line below stays put for the whole visit). Not in sudo (their marker isn't the viewed
    // member's) and not on an older page.
    if (sudoHidden || staffRead || identity.isSudo || before) return null;
    // A failed read shows no marker, as it always has.
    return createRepos(supabase).chat.readMarker(channel.id, identity.memberId).catch(() => null);
  };
  // Posting never happens in sudo, in a conversation the member is not in
  // or an archived one (chat_post_message checks the same again, and that the conversation is bridged).
  const postingQuery = async (): Promise<boolean> => !(sudoHidden || staffRead || identity.isSudo || channel.archived);
  // The conversation always shows its messages; a thread or a profile opens beside it.
  const messagesQuery = async () => {
    if (sudoHidden) return { page: null, root: null, threadPage: null };
    const [page, thread] = await Promise.all([
      loadMessages(createRepos(supabase), channel.id, { before: parseBefore(before) }),
      threadId
        ? Promise.all([loadMessage(createRepos(supabase), channel.id, threadId), loadMessages(createRepos(supabase), channel.id, { threadRootId: threadId })])
        : Promise.resolve(null),
    ]);
    if (thread && !thread[0]) notFound();
    return { page, root: thread?.[0] ?? null, threadPage: thread?.[1] ?? null };
  };
  // The member's unsent text for this conversation's box and the open thread's. Not in sudo (their drafts are not the viewed member's).
  const draftsQuery = async () => {
    const none = { conversation: null, thread: null, conversationFiles: [], threadFiles: [] };
    if (sudoHidden || staffRead || identity.isSudo) return none;
    const repo = createRepos(supabase).chatDrafts;
    const [conversation, thread] = await Promise.all([
      repo.get(identity.memberId, { channelId: channel.id, threadRootId: null }),
      threadId ? repo.get(identity.memberId, { channelId: channel.id, threadRootId: threadId }) : Promise.resolve(null),
    ]);
    // Image previews for the files kept with each draft (the bucket is private).
    const service = createServiceRoleClient();
    const [conversationFiles, threadFiles] = await Promise.all([
      withPreviewUrls(service, identity.memberId, conversation?.files ?? []),
      withPreviewUrls(service, identity.memberId, thread?.files ?? []),
    ]);
    return { conversation: conversation?.body ?? null, thread: thread?.body ?? null, conversationFiles, threadFiles };
  };
  // The notification setting of this conversation, for members who have chat notifications (not in sudo: it is the viewed member's own).
  const notifySettingQuery = async () => {
    if (sudoHidden || staffRead || identity.isSudo || !channel.joined) return null;
    if (!(await effectiveMemberHasFeature("chat_notifications", identity, await getUserFeaturePreviews(user.id)))) return null;
    // A failed read just hides the control.
    return createRepos(supabase).chat.notifySettingOf(channel.id, identity.memberId).catch(() => null);
  };
  const [{ page, root, threadPage }, preferredZone, people, readMarker, channels, memberCard, postingOn, drafts, notifySetting] = await Promise.all([
    timer.time("messages", messagesQuery()),
    // Times are in the reader's zone; "browser" means not detected yet, so the organization's.
    timer.time("timezone", getUserTimezonePreference()),
    sudoHidden ? Promise.resolve([]) : timer.time("members", loadChannelMembers(createRepos(supabase), channel.id)),
    timer.time("readMarker", readMarkerQuery()),
    timer.time("channels", loadChatChannelsForRender(identity.memberId, identity.isSudo)),
    profileId && !threadId && !sudoHidden ? loadMemberCard(createRepos(supabase), profileId) : Promise.resolve(null),
    timer.time("posting", postingQuery()),
    // A failed read just means no draft is put back.
    timer.time("drafts", draftsQuery().catch(() => ({ conversation: null, thread: null, conversationFiles: [], threadFiles: [] }))),
    timer.time("notifySetting", notifySettingQuery()),
  ]);
  timer.mark("parallel");
  const timeZone = isValidTimeZone(preferredZone) ? preferredZone : ORG_TIMEZONE;
  const mainRows = page?.messages ?? [];
  const threadRows = root ? [root, ...(threadPage?.messages ?? [])] : [];
  const { views, ...rendered } = await buildMessageViews(createRepos(supabase), channel, [...mainRows, ...threadRows], identity.memberId, timer);
  const ctx = chatTextContext(rendered, channels);
  timer.log(channel.kind === "channel" ? "channel" : "group");
  // Matched to their rows by id, not by position: a deleted message with no replies has a row but no view, so the
  // views are fewer than the rows and a position split would put the thread's root and replies into the main list.
  const viewById = new Map(views.map((v) => [v.id, v]));
  const viewsOf = (rows: { id: string }[]) => rows.flatMap((r) => viewById.get(r.id) ?? []);
  const messageViews = viewsOf(mainRows);
  const firstUnreadId = firstUnreadMessageId(messageViews, readMarker);
  const rootView = root ? (viewById.get(root.id) ?? null) : null;
  const replyViews = viewsOf(threadPage?.messages ?? []);
  const threadViews = rootView ? [rootView, ...replyViews] : [];
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
          {notifySetting && <NotifySetting channelId={channel.id} initial={notifySetting} isDirect={channel.kind !== "channel"} />}
          {people.length > 0 && (
            <Link data-track="chat-channel-members"
              href={`/chat/${channel.id}/members`}
              className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <AvatarStack people={people} size={24} max={3} />
              <span>
                {people.length}
                <span className="sr-only"> {people.length === 1 ? "member" : "members"}</span>
              </span>
            </Link>
          )}
        </header>
        {channel.includesStaff && !sudoHidden && <StaffDmNotice staffReader={staffRead} />}

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
                markRead={!identity.isSudo && !staffRead}
                renderedAt={renderedAt}
                catchUpIds={messageViews.filter((v) => v.replyCount > 0).map((v) => v.id)}
                latestAt={messageViews.length > 0 ? messageViews[messageViews.length - 1].createdAt : null}
                latestId={messageViews.length > 0 ? messageViews[messageViews.length - 1].id : null}
                focusId={listFocusId}
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
                renderedAt={renderedAt}
                focusId={listFocusId}
              />
            </section>
          )}
        </div>
        {canPost && (
          <Composer key={channel.id} channelId={channel.id} initialDraft={drafts.conversation} initialDraftFiles={drafts.conversationFiles} saveDrafts={!identity.isSudo} placeholder={`Message ${channel.label}`} viewer={viewer} showSent={!before} dropTargetIds={["chat-conversation", "chat-profile-panel"]} />
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
            focusId={threadFocusId}
          />
          {canPost && rootView.syncStatus === null && (
            <Composer key={rootView.id} channelId={channel.id} threadRootId={rootView.id} initialDraft={drafts.thread} initialDraftFiles={drafts.threadFiles} saveDrafts={!identity.isSudo} placeholder="Reply…" viewer={viewer} showSent dropTargetIds={["chat-thread-panel"]} />
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
