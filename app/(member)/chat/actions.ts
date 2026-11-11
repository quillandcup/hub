"use server";

import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendChatMessageToSlack } from "@/lib/chat/slack-post";
import { syncReactionToSlack } from "@/lib/chat/slack-react";
import { pullReadFromSlack, pushReadToSlack } from "@/lib/chat/slack-read";
import { pullMemberDms } from "@/lib/chat/slack-dms";
import { notifyChatMessage, resolveChatNotifications } from "@/lib/chat/notifications";
import { removeChatFileBytes } from "@/lib/chat/file-cleanup";
import { keepCopies } from "@/lib/chat/slack-upload";
import type { Json } from "@/lib/data/database.types";
import { deleteChatFileInSlack, deleteChatMessageInSlack, updateChatMessageInSlack } from "@/lib/chat/slack-edit";
import { getSlackConnectionStatus } from "@/lib/slack-connect";
import { isId } from "@/lib/ids";
import { ownDraftFiles } from "@/lib/chat/draft-files";
import type { DraftFile } from "@/lib/data/chat-drafts";
import { PENDING_FILE_PREFIX, parseChatFiles, type ChatFile } from "@/lib/chat/files";
import { MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, isOwnStagingPath, newStagingPath, type StagedUpload } from "@/lib/chat/staging";
import { SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import { clock } from "@/lib/clock";
import {
  buildMessageViews,
  chatTextContext,
  loadChannelForMember,
  loadChatChannels,
  loadMessage,
  loadMessages,
  loadMessagesByIds,
  loadUnreadCounts,
  type ChatMessageView,
} from "@/lib/chat/load";
import type { ChatTextContext } from "@/components/chat/ChatText";

import { withAction } from "@/lib/analytics/server";
import { refreshLinkPreviews } from "@/lib/chat/link-previews";
import { chatCaller, postingCaller } from "@/lib/chat/caller";
import { isHubOnlyMessage } from "@/lib/chat/hub-only";
import { getCoursesCaller } from "@/lib/courses/caller";
import { extractLessonLink } from "@/lib/chat/lesson-links";
import { sharedVideoDefaultText } from "@/lib/chat/video-link";
import { APP_URL } from "@/lib/config";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
/**
 * Saves what the signed-in member has typed and attached and not sent in a conversation's box (or a thread's reply
 * box, with `threadRootId`) so it is there when they come back; blank text with no files removes the draft.
 * The files are already uploaded to the member's staging folder; only their own paths are kept. Quietly
 * does nothing without posting (they could not send it) or in sudo (read-only), and for ids that are
 * not ours. Only stored, never sent anywhere: Slack's own drafts have no public API.
 */
export async function saveChatDraft(channelId: string, threadRootId: string | null, body: string, files: DraftFile[] = []): Promise<void> {
  if (!isId(channelId, "chn") || (threadRootId !== null && !isId(threadRootId, "msg")) || typeof body !== "string") return;
  const caller = await postingCaller();
  if (!caller) return;
  const memberId = caller.identity.memberId;
  const place = { channelId, threadRootId };
  const kept = ownDraftFiles(memberId, files, MAX_CHAT_FILES);
  try {
    const drafts = createRepos(await createClient()).chatDrafts;
    const before = await drafts.get(memberId, place);
    await drafts.save(memberId, place, { body, files: kept });
    // A file taken out of the draft is gone for good: remove its staged bytes (a failure is left to the nightly staging purge).
    const still = new Set(kept.map((f) => f.path));
    const removed = (before?.files ?? []).map((f) => f.path).filter((path) => !still.has(path) && isOwnStagingPath(memberId, path));
    if (removed.length > 0) {
      const { error } = await createServiceRoleClient().storage.from(SLACK_FILES_BUCKET).remove(removed);
      if (error) console.error("removing a draft's staged files failed:", error.message);
    }
  } catch (e) {
    // A conversation they can no longer see, or a database hiccup: the text stays in the box, so say nothing to the member.
    console.error("chat draft save failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * The signed-in member has seen a conversation through `through` (the time of the newest message
 * they had on screen): moves their own read marker forward (the `chat_mark_read` function can only
 * touch the caller's row, in a conversation they are in, and never backward or past now). `through`
 * is the message's own created_at string, passed on untouched: a JavaScript Date would round it to
 * the millisecond, leaving the newest message a few microseconds "unread" for good.
 * Quietly does nothing when chat is off for them or in sudo, which is read-only, so a viewing
 * admin never marks things read for the member they are looking at.
 */
export async function markChatRead(channelId: string, through: string): Promise<void> {
  if (!isId(channelId, "chn")) return;
  if (Number.isNaN(Date.parse(through))) return;
  const caller = await chatCaller();
  if (!caller || caller.identity.isSudo) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_mark_read", { p_channel_id: channelId, p_through: through });
  if (error) {
    console.error("chat_mark_read failed:", error.message);
    return;
  }
  // Slack stops showing it as unread too, once the response is out (members who connected Slack only).
  after(() => pushReadToSlack(createServiceRoleClient(), { memberId: caller.identity.memberId, channelId, through }).catch((e) => console.error("pushReadToSlack failed:", e)));
  // Read here means read for notifications too: the conversation's in-app notifications are marked read.
  after(() => resolveChatNotifications(createRepos(createServiceRoleClient()), caller.identity.memberId, channelId));
}

/**
 * The member came back to the Hub (or opened the search box): bring their read markers up to what
 * they have read in Slack, and answer with the unread counts as they now stand. `openChannelId` is
 * the conversation on screen, whose marker is left alone so its "New" line doesn't jump. Null when
 * nothing was pulled (not connected to Slack, asked again within the throttle, sudo, chat off), so
 * the caller keeps the numbers it has.
 */
export async function syncChatReadFromSlack(openChannelId: string | null): Promise<Record<string, number> | null> {
  const caller = await chatCaller();
  if (!caller || caller.identity.isSudo) return null;
  const exceptChannelId = openChannelId && isId(openChannelId, "chn") ? openChannelId : null;
  // Their Slack DMs come in the same way (a member's own token is the only way to read them), after the
  // response, for members the bridge is switched on for; throttled on its own, longer than the read pull.
  const memberId = caller.identity.memberId;
  if (await effectiveMemberHasFeature("slack_dm_bridge", caller.identity, await getUserFeaturePreviews(caller.userId))) {
    after(async () => {
      try {
        await pullMemberDms(createServiceRoleClient(), memberId);
      } catch (error) {
        console.error("pullMemberDms threw for %s:", memberId, error);
      }
    });
  }
  const pulled = await pullReadFromSlack(createServiceRoleClient(), caller.identity.memberId, { exceptChannelId }).catch((e) => {
    console.error("pullReadFromSlack failed:", e);
    return false;
  });
  return pulled ? loadUnreadCounts(await createClient()) : null;
}

export interface OlderChat {
  /** Oldest first, the page of messages before the cursor. */
  views: ChatMessageView[];
  ctx: ChatTextContext;
  /** Cursor for the page before this one, or null at the start of the conversation. */
  olderBefore: string | null;
}

/**
 * The page of top-level messages before `before` (a created_at cursor, passed through untouched so
 * its microseconds survive), for "load older" in the conversation. Same rules as the page: only
 * what the member may read, and nothing for a restricted conversation while viewing as a member.
 * Null when it can't be loaded (no access, bad cursor).
 */
export async function loadOlderChat(channelId: string, before: string): Promise<OlderChat | null> {
  if (!isId(channelId, "chn") || Number.isNaN(Date.parse(before))) return null;
  const caller = await chatCaller();
  if (!caller) return null;
  const { identity } = caller;

  const supabase = await createClient();
  const channel = await loadChannelForMember(createRepos(supabase), channelId, identity.memberId, identity.isSudo);
  if (!channel || (identity.isSudo && channel.restricted)) return null;

  const page = await loadMessages(createRepos(supabase), channel.id, { before });
  const [{ views, ...rendered }, channels] = await Promise.all([
    buildMessageViews(createRepos(supabase), channel, page.messages, identity.memberId),
    loadChatChannels(createRepos(supabase), identity.memberId, identity.isSudo),
  ]);
  return { views, ctx: chatTextContext(rendered, channels), olderBefore: page.olderBefore };
}

/**
 * The newest page of top-level messages, for keeping an open conversation current without
 * re-rendering the page and layout: only the messages (the sidebar, members, read marker and the
 * rest are untouched), plus the messages in `alsoMessageIds` (ones whose reactions changed, wherever they
 * are in the list). Same access rules as the page and `loadOlderChat`; the text context carries
 * just the names found in these messages (the list merges it into what it already has), so the
 * channel list isn't read again. `withReadMarker` also returns where the member has read up to now (for a
 * page that came from the client cache, whose unread line is out of date). Null when it can't be loaded,
 * and the caller refreshes the page.
 */
export async function loadLatestChat(channelId: string, alsoMessageIds: string[] = [], withReadMarker = false): Promise<LatestChat | null> {
  if (!isId(channelId, "chn")) return null;
  const started = performance.now();
  const caller = await chatCaller();
  if (!caller) return null;
  const { identity } = caller;
  const afterAuth = performance.now();

  const supabase = await createClient();
  const channel = await loadChannelForMember(createRepos(supabase), channelId, identity.memberId, identity.isSudo);
  if (!channel || (identity.isSudo && channel.restricted)) return null;
  const afterChannel = performance.now();

  const markerQuery = async (): Promise<string | null | undefined> => {
    if (!withReadMarker) return undefined;
    if (identity.isSudo) return null;
    // A failed read shows no marker, as it always has.
    return createRepos(supabase).chat.readMarker(channel.id, identity.memberId).catch(() => null);
  };
  const wanted = [...new Set(alsoMessageIds.filter((m) => isId(m, "msg")))].slice(0, 50);
  const [page, extra, readMarker] = await Promise.all([
    loadMessages(createRepos(supabase), channel.id, {}),
    loadMessagesByIds(createRepos(supabase), channel.id, wanted),
    markerQuery(),
  ]);
  const afterMessages = performance.now();
  // The newest page, plus any other messages asked for (ones whose reactions changed), once each.
  const inPage = new Set(page.messages.map((m) => m.id));
  const messages = [...page.messages, ...extra.filter((m) => !inPage.has(m.id))];
  const { views, ...rendered } = await buildMessageViews(createRepos(supabase), channel, messages, identity.memberId);
  const done = performance.now();
  // Where the time goes, for tuning: this runs on every live change in an open conversation.
  console.info(
    "[chat] loadLatestChat %dms (auth %d, channel %d, messages %d, views %d)",
    Math.round(done - started),
    Math.round(afterAuth - started),
    Math.round(afterChannel - afterAuth),
    Math.round(afterMessages - afterChannel),
    Math.round(done - afterMessages)
  );
  // Asked for but not shown: deleted (a delete made in Slack leaves a message with no replies out of the views) or no
  // longer readable. The open list takes them away.
  const shown = new Set(views.map((v) => v.id));
  const removedIds = wanted.filter((id) => !shown.has(id));
  return { views, ctx: chatTextContext(rendered, []), olderBefore: page.olderBefore, readMarker, removedIds, at: new Date().toISOString() };
}

export interface LatestChat extends OlderChat {
  /** When the server read these messages: a page rendered before this has older data than the list now shows. */
  at?: string;
  /** Messages asked about by id that are gone now (deleted, or not readable): the open list drops them. */
  removedIds?: string[];
  /** Where the member has read up to (null: nowhere, or sudo). Only when asked for. */
  readMarker?: string | null;
}

export interface ThreadChat {
  /** Messages asked about by id that are gone (deleted, or not readable): the open thread drops them. */
  removedIds?: string[];
  /** The thread's root message first, then its replies, oldest first. */
  views: ChatMessageView[];
  ctx: ChatTextContext;
}

/**
 * An open thread as it is now, for keeping the thread panel current without re-rendering the page
 * (see `loadLatestChat`). Same access rules as the page. Null when the thread can't be loaded (no
 * access, or the root is gone), and the caller refreshes the page.
 */
export async function loadThreadChat(channelId: string, threadRootId: string, alsoMessageIds: string[] = []): Promise<ThreadChat | null> {
  if (!isId(channelId, "chn") || !isId(threadRootId, "msg")) return null;
  const caller = await chatCaller();
  if (!caller) return null;
  const { identity } = caller;

  const supabase = await createClient();
  const channel = await loadChannelForMember(createRepos(supabase), channelId, identity.memberId, identity.isSudo);
  if (!channel || (identity.isSudo && channel.restricted)) return null;

  const [root, replies] = await Promise.all([
    loadMessage(createRepos(supabase), channel.id, threadRootId),
    loadMessages(createRepos(supabase), channel.id, { threadRootId }),
  ]);
  if (!root) return null;
  const { views, ...rendered } = await buildMessageViews(createRepos(supabase), channel, [root, ...replies.messages], identity.memberId);
  // Messages that changed and aren't in what came back: a reply deleted in Slack is left out of the views, but one
  // beyond the page, or in another view of the conversation, is merely not shown here. Look each up to tell which is gone.
  const shown = new Set(views.map((v) => v.id));
  const candidates = [...new Set(alsoMessageIds.filter((m) => isId(m, "msg") && !shown.has(m)))].slice(0, 50);
  const rows = await Promise.all(candidates.map((id) => loadMessage(createRepos(supabase), channel.id, id)));
  const removedIds = candidates.filter((_, i) => !rows[i] || rows[i]?.deleted_at);
  return { views, ctx: chatTextContext(rendered, []), removedIds };
}

export type SendChatResult = { ok: true; id: string } | { ok: false; error: string };

/** What chat_post_message's 'chat_post: <reason>' errors mean to the person who wrote the message. */
const POST_ERRORS: Record<string, string> = {
  no_member: "You need a member profile to post.",
  not_in_channel: "You can only post in conversations you are in.",
  not_bridged: "This conversation isn't connected to Slack, so it can't take posts yet.",
  archived: "This conversation is archived.",
  empty: "Write something first.",
  too_long: "That message is too long (4,000 characters at most).",
  bad_thread: "That thread can't be replied to.",
  bad_files: "Those files can't be sent.",
  bad_video: "That video can't be shared.",
  not_allowed: "Only an admin can open a video to the whole conversation.",
};

export type PrepareUploadsResult = { ok: true; uploads: { path: string; token: string }[] } | { ok: false; error: string };

/**
 * Places for the browser to put attachments: one signed upload per file, in the member's own folder
 * of the private bucket (the file goes straight to Storage; a server action can't take a big body).
 * Same gate as posting, and the same limits the send checks again.
 */
export async function prepareChatUploads(files: { name: string; size: number }[]): Promise<PrepareUploadsResult> {
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Posting isn't available to you yet." };
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_CHAT_FILES) {
    return { ok: false, error: `Attach up to ${MAX_CHAT_FILES} files at a time.` };
  }
  if (files.some((f) => typeof f?.name !== "string" || !f.name || !(f.size >= 0) || f.size > MAX_CHAT_FILE_BYTES)) {
    return { ok: false, error: `Files can be up to ${MAX_CHAT_FILE_BYTES / (1024 * 1024)} MB each.` };
  }
  const bucket = createServiceRoleClient().storage.from(SLACK_FILES_BUCKET);
  const uploads: { path: string; token: string }[] = [];
  for (const f of files) {
    const path = newStagingPath(caller.identity.memberId, f.name, clock.now(), crypto.randomUUID());
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) {
      console.error("createSignedUploadUrl failed:", error?.message);
      return { ok: false, error: "Couldn't start the upload. Try again." };
    }
    uploads.push({ path, token: data.token });
  }
  return { ok: true, uploads };
}

/**
 * The files JSON for chat_post_message from what the browser says it uploaded: only the member's own
 * staged paths, and only ones that are really in the bucket, with their real size. Null if anything is off.
 */
async function stagedFilesFor(memberId: string, uploads: StagedUpload[]): Promise<Record<string, unknown>[] | null> {
  if (!Array.isArray(uploads) || uploads.length > MAX_CHAT_FILES) return null;
  const bucket = createServiceRoleClient().storage.from(SLACK_FILES_BUCKET);
  const files: Record<string, unknown>[] = [];
  for (const u of uploads) {
    if (typeof u?.path !== "string" || typeof u.name !== "string" || !u.name || !isOwnStagingPath(memberId, u.path)) return null;
    const slash = u.path.lastIndexOf("/");
    const { data } = await bucket.list(u.path.slice(0, slash), { search: u.path.slice(slash + 1), limit: 5 });
    const size = (data?.find((o) => o.name === u.path.slice(slash + 1))?.metadata as { size?: number } | undefined)?.size;
    if (typeof size !== "number" || size > MAX_CHAT_FILE_BYTES) return null;
    files.push({ id: `${PENDING_FILE_PREFIX}${crypto.randomUUID()}`, name: u.name.slice(0, 200), mimetype: typeof u.mimetype === "string" ? u.mimetype.slice(0, 100) : "application/octet-stream", size, staged: u.path });
  }
  return files;
}

/**
 * Link previews for a message the member wrote in the Hub (docs/SLACK_BRIDGED_CHAT.md, "Link previews"), run after the response so the
 * send never waits for another site. Behind `chat_link_previews` for the sender; for anyone else nothing is fetched and the link stays
 * plain text. Looks only at addresses it has not looked at, so an edit that keeps a link does not fetch it again. Never throws.
 */
async function previewLinksAfterSend(caller: NonNullable<Awaited<ReturnType<typeof postingCaller>>>, messageId: string, body: string): Promise<void> {
  try {
    if (!(await effectiveMemberHasFeature("chat_link_previews", caller.identity, await getUserFeaturePreviews(caller.userId)))) return;
    const { looked } = await refreshLinkPreviews(createRepos(createServiceRoleClient()).chatLinkPreviews, messageId, body, { ownOrigin: new URL(APP_URL).origin });
    if (looked.length === 0) return;
    // What happened, never which address: the detail is a word, not a link.
    await withAction(
      "chat_link_previews_built",
      async () => looked,
      (drafts) => {
        const ok = drafts.some((d) => d.status === "ok");
        return { ok, detail: ok ? (drafts.some((d) => d.kind === "image") ? "image" : "link") : drafts.some((d) => d.status === "blocked") ? "blocked" : "failed" };
      }
    );
  } catch (error) {
    console.error("[chat] link previews of %s failed:", messageId, error instanceof Error ? error.message : "unknown error");
  }
}

/**
 * The signed-in member posts `body` to a conversation (or as a reply in a thread). The message is
 * written first, as the member (chat_post_message checks they are in the conversation and that it
 * is bridged and open), then sent to Slack after the response (as them if they connected Slack,
 * else as the bot under their name and photo). If Slack is down the message stays in the Hub
 * marked failed, and the member can retry it; the nightly chat run retries too.
 */
async function sendChatMessageImpl(channelId: string, body: string, threadRootId?: string, uploads: StagedUpload[] = [], share?: { lessonId: string; openToChannel: boolean }): Promise<SendChatResult> {
  if (!isId(channelId, "chn") || (threadRootId !== undefined && !isId(threadRootId, "msg"))) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Posting isn't available to you yet." };
  const supabase = await createClient();
  // A Hub-only conversation (a direct message) never touches Slack: no connection needed, nothing sent after.
  const hubOnly = (await createRepos(supabase).chat.bridgeState(channelId).catch(() => null))?.bridge_mode === "app_only";
  // Messages are posted as the member, with their own Slack token, and there is no bot fallback: without a
  // connection nothing would reach Slack, so say so now instead of saving a message that can only fail.
  if (!hubOnly && !(await getSlackConnectionStatus(createServiceRoleClient(), caller.identity.memberId)).connected) {
    return { ok: false, error: "Connect Slack in Settings to post: your messages are posted as you." };
  }

  // A lesson address pasted into the message (the lesson page's "Copy link to paste in chat") becomes a video card, here or in a
  // thread or direct message, when this sender could share that lesson. If any check fails the address stays as text in the
  // message, like any link: never an error for pasting a link.
  let text = body;
  if (!share && uploads.length === 0) {
    const pasted = extractLessonLink(body, APP_URL);
    const check = pasted ? await checkShareable(caller, pasted.lessonId) : null;
    if (pasted && check?.ok) {
      // The open-share marker counts only from an admin acting as themselves; from anyone else the share is just closed.
      share = { lessonId: pasted.lessonId, openToChannel: pasted.openToChannel && check.isAdminActing };
      text = pasted.body || sharedVideoDefaultText(check.lessonTitle);
    }
  }

  let files: Record<string, unknown>[] | null = null;
  if (uploads.length > 0) {
    // Attachments aren't supported in Hub-only conversations yet (chat_post_message refuses them too).
    files = hubOnly ? null : await stagedFilesFor(caller.identity.memberId, uploads);
    if (!files) return { ok: false, error: hubOnly ? "Files can't be sent in direct messages yet." : POST_ERRORS.bad_files };
  }

  // A message that shares a lesson video is written together with its video row in one call (chat_post_shared_video), so
  // another member's page never receives the message without its card. The function checks the sharer again in the database.
  const { data, error } = share
    ? await supabase.rpc("chat_post_shared_video", {
        p_channel_id: channelId,
        p_body: text,
        p_lesson_id: share.lessonId,
        p_open_to_channel: share.openToChannel,
        p_thread_root_id: (threadRootId ?? null) as string, // null when absent (the generated type has no null)
      })
    : await supabase.rpc("chat_post_message", {
        p_channel_id: channelId,
        p_body: body,
        p_thread_root_id: (threadRootId ?? null) as string, // null when absent (the generated type has no null)
        ...(files ? { p_files: files } : {}),
      });
  if (error || !data) {
    const reason = /chat_post: (\w+)/.exec(error?.message ?? "")?.[1];
    if (!reason) console.error("%s failed:", share ? "chat_post_shared_video" : "chat_post_message", error?.message);
    return { ok: false, error: (reason && POST_ERRORS[reason]) || "Something went wrong. Try again." };
  }

  // Slack takes a second or more; the member shouldn't wait for it. The message is already saved
  // (pending), so return now and send after the response: the page shows it at once, and flips it to
  // sent through Realtime when Slack has it. A failure marks it failed (Retry) and the nightly run retries.
  const messageId = data as string;
  // What was written is sent, so it is no longer a draft (the box also stops saving it as it clears).
  await createRepos(supabase).chatDrafts.clear(caller.identity.memberId, { channelId, threadRootId: threadRootId ?? null }).catch((e) => console.error("chat draft clear failed:", e));
  // Tell the members it is for (their direct message, a mention, a channel they follow), after the response.
  after(() => notifyChatMessage(createRepos(createServiceRoleClient()), messageId));
  after(() => previewLinksAfterSend(caller, messageId, text));
  if (hubOnly) return { ok: true, id: messageId };
  after(async () => {
    try {
      await sendChatMessageToSlack(createServiceRoleClient(), messageId);
    } catch (error) {
      console.error("sendChatMessageToSlack threw for %s:", messageId, error);
    }
  });
  return { ok: true, id: messageId };
}

/** What `checkShareable` found out, for the share action and for a pasted lesson address. */
type ShareCheck = { ok: true; lessonTitle: string; isAdminActing: boolean } | { ok: false; error: string };

/**
 * Whether this caller may share this lesson's video into chat: `chat_videos` on, the lesson open to them (or staff acting as
 * themselves) with a ready video, and the course checks the lesson page applies. The database repeats the sharer checks
 * (`chat_post_shared_video`); this is for the friendly answer and for deciding quietly whether a pasted address counts.
 */
async function checkShareable(caller: NonNullable<Awaited<ReturnType<typeof postingCaller>>>, lessonId: string): Promise<ShareCheck> {
  const refused: ShareCheck = { ok: false, error: "That video can't be shared." };
  if (!(await effectiveMemberHasFeature("chat_videos", caller.identity, await getUserFeaturePreviews(caller.userId)))) {
    return { ok: false, error: "Sharing videos isn't available to you yet." };
  }
  const courses = await getCoursesCaller();
  const repos = createRepos(createServiceRoleClient());
  const lesson = courses ? await repos.courses.lessonById(lessonId) : null;
  const video = lesson?.video_id ? (await repos.courses.videosByIds([lesson.video_id]))[0] : undefined;
  if (!courses || !lesson || !(lesson.state === "open" || courses.scope.isAdminActing) || video?.status !== "ready") return refused;
  if (!canOpenLessons(await loadMemberCourseAccess(repos, courses.scope, lesson.course_id))) return refused;
  return { ok: true, lessonTitle: lesson.title, isAdminActing: courses.scope.isAdminActing };
}

/**
 * The signed-in member shares a course lesson's video into a conversation: a message (their own words, or "Shared a lesson
 * video: <title>") that shows the lesson's video as a card everyone who can read the message sees. Behind `chat_videos` on
 * top of posting. The sharer must be able to open the lesson themselves (same checks as the lesson page, repeated in the
 * database by `chat_post_shared_video`). Playing needs the course too, unless an admin shares it with `openToChannel`: then
 * every member who can read the message may play it (default off; admins only, checked here and in the database).
 * The message and its video row are written in one call (no window in which the message exists without its card), and
 * Slack gets it after the response with links back to the Hub. The same share happens when a lesson address is pasted into
 * any message (`sendChatMessageImpl`), where it also works in threads and direct messages.
 */
async function shareLessonVideoImpl(channelId: string, lessonId: string, note: string, openToChannel = false): Promise<SendChatResult> {
  if (!isId(channelId, "chn") || !isId(lessonId, "les") || typeof note !== "string" || typeof openToChannel !== "boolean") return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Sharing videos isn't available to you yet." };
  const check = await checkShareable(caller, lessonId);
  if (!check.ok) return check;
  if (openToChannel && !check.isAdminActing) return { ok: false, error: POST_ERRORS.not_allowed };

  return sendChatMessageImpl(channelId, note.trim() || sharedVideoDefaultText(check.lessonTitle), undefined, [], { lessonId, openToChannel });
}

export type ToggleReactionResult = { ok: true; active: boolean } | { ok: false; error: string };

const REACT_ERRORS: Record<string, string> = {
  no_member: "You need a member profile to react.",
  no_message: "That message isn't available.",
  archived: "This conversation is archived.",
  bad_emoji: "That emoji can't be used.",
};

/**
 * The signed-in member adds their reaction to a message, or takes it back if they already have
 * it. It is sent to Slack as them, so it needs their Slack connection. Same gate as posting.
 */
async function toggleChatReactionImpl(messageId: string, emoji: string): Promise<ToggleReactionResult> {
  if (!isId(messageId, "msg")) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Reacting isn't available to you yet." };

  const supabase = await createClient();
  const hubOnly = await isHubOnlyMessage(createRepos(supabase).chat, messageId);

  // Reactions go to Slack as the member (their own token; the bot can't react under a name), and there is no
  // Hub-only fallback: without a connection one would be hidden here and never reach Slack, and a reaction
  // the member made in Slack could not be taken back from here. So say what to do instead.
  if (!hubOnly && !(await getSlackConnectionStatus(createServiceRoleClient(), caller.identity.memberId)).connected) {
    return { ok: false, error: "Connect Slack in Settings to react: your reactions are sent as you." };
  }

  const { data, error } = await supabase.rpc("chat_toggle_reaction", { p_message_id: messageId, p_emoji: emoji });
  if (error || typeof data !== "boolean") {
    const reason = /chat_react: (\w+)/.exec(error?.message ?? "")?.[1];
    if (!reason) console.error("chat_toggle_reaction failed:", error?.message);
    return { ok: false, error: (reason && REACT_ERRORS[reason]) || "Something went wrong. Try again." };
  }
  // A member who connected Slack has it in Slack too, as them: after the response, so the chip
  // updates at once, and never able to fail the reaction itself.
  if (hubOnly) return { ok: true, active: data };
  const memberId = caller.identity.memberId;
  after(async () => {
    try {
      await syncReactionToSlack(createServiceRoleClient(), { messageId, memberId, emoji, active: data });
    } catch (error) {
      console.error("syncReactionToSlack threw:", error);
    }
  });
  return { ok: true, active: data };
}

/** The author sends one of their own failed messages to Slack again. */
async function retryChatMessageImpl(messageId: string): Promise<SendChatResult> {
  if (!isId(messageId, "msg")) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Posting isn't available to you yet." };

  // Under the caller's RLS, so only a message they can see; the author check is on top.
  const supabase = await createClient();
  const row = await createRepos(supabase).chat.retryState(messageId).catch(() => null);
  if (!row || row.origin !== "app" || row.author_member_id !== caller.identity.memberId || row.slack_sync_status === "sent" || row.slack_sync_status === null) {
    return { ok: false, error: "That message can't be retried." };
  }
  const service = createServiceRoleClient();
  if (!(await getSlackConnectionStatus(service, caller.identity.memberId)).connected) {
    return { ok: false, error: "Connect Slack in Settings, then retry: your messages are posted as you." };
  }
  const result = await sendChatMessageToSlack(service, messageId);
  return result === "failed" ? { ok: false, error: "Slack didn't take it. Try again in a moment." } : { ok: true, id: messageId };
}

export type ChangeChatResult = { ok: true } | { ok: false; error: string };

const CHANGE_ERRORS: Record<string, string> = {
  no_member: "You need a member profile to do that.",
  not_yours: "That message can't be changed.",
  archived: "This conversation is archived.",
  empty: "Write something first.",
  too_long: "That message is too long (4,000 characters at most).",
};

const changeError = (error: { message?: string } | null, verb: "edit" | "delete"): string => {
  const reason = new RegExp(`chat_${verb}: (\\w+)`).exec(error?.message ?? "")?.[1];
  if (!reason) console.error("chat_%s_message failed:", verb, error?.message);
  return (reason && CHANGE_ERRORS[reason]) || "Something went wrong. Try again.";
};

/**
 * The author edits one of their own messages written in the Hub. Slack first, as whoever posted it
 * (their own token or the bot), then the Hub's copy, so the Hub never shows text Slack doesn't have.
 * Same gate as posting.
 */
async function editChatMessageImpl(messageId: string, body: string, uploads: StagedUpload[] = []): Promise<ChangeChatResult> {
  if (!isId(messageId, "msg")) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Editing isn't available to you yet." };

  // Refuse what the database would refuse before touching Slack.
  const text = body.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (text === "") return { ok: false, error: CHANGE_ERRORS.empty };
  if (text.length > 4000) return { ok: false, error: CHANGE_ERRORS.too_long };

  const supabase = await createClient();
  const service = createServiceRoleClient();
  const hubOnly = await isHubOnlyMessage(createRepos(supabase).chat, messageId);

  // Files added in the edit box: the member's own staged uploads, checked as for a new message.
  let added: Record<string, unknown>[] = [];
  let existingIds: string[] = [];
  const bytes: { staged: string; file: Buffer; filename: string }[] = [];
  if (uploads.length > 0) {
    if (hubOnly) return { ok: false, error: "Files can't be sent in direct messages yet." };
    const staged = await stagedFilesFor(caller.identity.memberId, uploads);
    if (!staged) return { ok: false, error: POST_ERRORS.bad_files };
    const current = await createRepos(service).chat.outboxMessage(messageId).catch(() => null);
    existingIds = parseChatFiles(current?.files).map((f) => f.id);
    if (existingIds.length + staged.length > MAX_CHAT_FILES) return { ok: false, error: `A message can have up to ${MAX_CHAT_FILES} files.` };
    for (const f of staged) {
      const { data } = await service.storage.from(SLACK_FILES_BUCKET).download(f.staged as string);
      if (!data) return { ok: false, error: "Couldn't read an uploaded file. Try again." };
      bytes.push({ staged: f.staged as string, file: Buffer.from(await data.arrayBuffer()), filename: f.name as string });
    }
    added = staged;
  }

  // A Hub-only message (in a direct message) has no Slack copy to change first.
  let fileIds: string[] = [];
  if (!hubOnly) {
    const inSlack = await updateChatMessageInSlack(service, {
      messageId,
      memberId: caller.identity.memberId,
      body: text,
      ...(bytes.length > 0 ? { addFiles: { existingIds, uploads: bytes.map(({ file, filename }) => ({ file, filename })) } } : {}),
    });
    if (!inSlack.ok) return inSlack;
    fileIds = inSlack.fileIds ?? [];
  }

  const { error } = await supabase.rpc("chat_edit_message", { p_message_id: messageId, p_body: text });
  if (error) return { ok: false, error: changeError(error, "edit") };
  // An edit that adds or changes a link gets its preview; one that keeps the same links fetches nothing.
  after(() => previewLinksAfterSend(caller, messageId, text));

  if (bytes.length > 0) {
    const files = added.map((f, i) => ({ id: fileIds[i], name: f.name, mimetype: f.mimetype, size: f.size }));
    const { error: addError } = await supabase.rpc("chat_add_message_files", { p_message_id: messageId, p_files: files as Json });
    if (addError) return { ok: false, error: changeError(addError, "edit") };
    // The bytes are in hand: keep them as the permanent copies, so the Hub never asks Slack for its own upload.
    const target = await createRepos(service).chat.slackTarget(messageId).catch(() => null);
    if (target?.slackChannelId && target.slackTs) {
      await keepCopies(
        service,
        files as ChatFile[],
        files.map((_, i) => ({ id: "", name: null, mimetype: null, size: null, width: null, height: null, staged: bytes[i].staged })),
        new Map(bytes.map((b) => [b.staged, b.file])),
        target.slackChannelId,
        target.slackTs
      );
    }
  }
  return { ok: true };
}

/** The author deletes one of their own messages written in the Hub: in Slack first, then the Hub (a tombstone, the text kept). */
async function deleteChatMessageImpl(messageId: string): Promise<ChangeChatResult> {
  if (!isId(messageId, "msg")) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Deleting isn't available to you yet." };

  const supabase = await createClient();
  if (!(await isHubOnlyMessage(createRepos(supabase).chat, messageId))) {
    const inSlack = await deleteChatMessageInSlack(createServiceRoleClient(), { messageId, memberId: caller.identity.memberId });
    if (!inSlack.ok) return inSlack;
  }

  const { error } = await supabase.rpc("chat_delete_message", { p_message_id: messageId });
  if (error) return { ok: false, error: changeError(error, "delete") };
  return { ok: true };
}

/**
 * The author removes a card (a link preview, or one of Slack's unfurls) from their own message, like the X on a preview in Slack. Slack's
 * cannot be taken away in Slack from here, so the Hub records the removal and stops drawing the card (docs/SLACK_BRIDGED_CHAT.md, "Link previews").
 * The write is the author's own, as themselves: row-level security lets only the author of the message (a Slack author matched to a member
 * counts) write it, so another member's call is refused. The key names the card (`unfurlKey`); the database refuses anything but an address or a position.
 * An edit that fetches the preview again finds the mark by its address, so the card does not come back.
 */
async function hideChatUnfurlImpl(messageId: string, key: string): Promise<ChangeChatResult> {
  if (!isId(messageId, "msg") || typeof key !== "string" || key.length > 2100 || !/^(url:https?:\/\/\S+|idx:\d{1,2})$/.test(key)) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Editing isn't available to you yet." };
  try {
    await createRepos(await createClient()).chatLinkPreviews.hide(messageId, key);
  } catch (error) {
    // Not the author, or the message is gone: the database says no. The key can hold an address, so only the message is named.
    console.error("[chat] removing a card of %s failed:", messageId, error instanceof Error ? error.message : "unknown error");
    return { ok: false, error: "That preview can't be removed." };
  }
  return { ok: true };
}

/** The author removes one attachment from their own Hub message: in Slack first, then the Hub's file list. */
async function deleteChatFileImpl(messageId: string, fileId: string): Promise<ChangeChatResult> {
  if (!isId(messageId, "msg") || !fileId || fileId.startsWith(PENDING_FILE_PREFIX)) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Deleting isn't available to you yet." };

  const service = createServiceRoleClient();
  const inSlack = await deleteChatFileInSlack(service, { messageId, memberId: caller.identity.memberId, fileId });
  if (!inSlack.ok) return inSlack;

  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_delete_file", { p_message_id: messageId, p_file_id: fileId });
  if (error) return { ok: false, error: changeError(error, "delete") };

  // Last, once nothing lists the file any more: a failure here only leaves bytes for the sweep.
  await removeChatFileBytes(service, fileId);
  return { ok: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function sendChatMessage(...args: Parameters<typeof sendChatMessageImpl>): ReturnType<typeof sendChatMessageImpl> {
  return withAction("chat_message_sent", () => sendChatMessageImpl(...args));
}

export async function shareLessonVideoInChat(...args: Parameters<typeof shareLessonVideoImpl>): ReturnType<typeof shareLessonVideoImpl> {
  return withAction("chat_video_shared", () => shareLessonVideoImpl(...args));
}

export async function toggleChatReaction(...args: Parameters<typeof toggleChatReactionImpl>): ReturnType<typeof toggleChatReactionImpl> {
  return withAction("chat_reaction_toggled", () => toggleChatReactionImpl(...args));
}

export async function editChatMessage(...args: Parameters<typeof editChatMessageImpl>): ReturnType<typeof editChatMessageImpl> {
  return withAction("chat_message_edited", () => editChatMessageImpl(...args));
}

export async function deleteChatMessage(...args: Parameters<typeof deleteChatMessageImpl>): ReturnType<typeof deleteChatMessageImpl> {
  return withAction("chat_message_deleted", () => deleteChatMessageImpl(...args));
}

export async function hideChatUnfurl(...args: Parameters<typeof hideChatUnfurlImpl>): ReturnType<typeof hideChatUnfurlImpl> {
  return withAction("chat_unfurl_hidden", () => hideChatUnfurlImpl(...args));
}

export async function deleteChatFile(...args: Parameters<typeof deleteChatFileImpl>): ReturnType<typeof deleteChatFileImpl> {
  return withAction("chat_file_deleted", () => deleteChatFileImpl(...args));
}

export async function retryChatMessage(...args: Parameters<typeof retryChatMessageImpl>): ReturnType<typeof retryChatMessageImpl> {
  return withAction("chat_message_retried", () => retryChatMessageImpl(...args));
}
