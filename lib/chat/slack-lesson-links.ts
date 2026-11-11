import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/config";
import { clock } from "@/lib/clock";
import { extractLessonLink } from "@/lib/chat/lesson-links";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import type { Repos } from "@/lib/data/repos";
import { membersWithFeature } from "@/lib/features.server";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { updateChatMessageInSlack } from "@/lib/chat/slack-edit";
import { sharedVideoDefaultText, sharedVideoSlackLine } from "@/lib/chat/video-link";
import { escapeForSlack } from "@/lib/chat/slack-post";
import { parseChatFiles } from "@/lib/chat/files";

/**
 * A lesson address pasted into Slack becomes the shared-video card in Hub Chat, the same conversion a message sent from Hub Chat gets
 * (`sendChatMessageImpl`, docs/SLACK_BRIDGED_CHAT.md, "Paste a lesson link, anywhere"). Slack messages reach the Hub as typed, so this
 * runs when one arrives (the webhook) and in the nightly import, which catches what the webhook missed. Service-role repositories.
 *
 * The author is whoever Slack's user maps to in the Hub, and the same rules apply as in the Hub: they must have `chat_videos`, and be
 * able to open the lesson themselves (an admin any). A Slack author with no Hub member, or without those, leaves the message as it is: a plain link.
 * The open-to-everyone marker (`?share=open`) counts only when the author is an admin. The share is only ever added: editing the
 * link out of the message later leaves the card (the same as an edit in the Hub). Slack shows the plain link until the author's own
 * Slack account rewrites it (`rewriteInSlack`, below).
 */

/** Called once a message became a card, with the text either side of the pasted address (which is taken out); never throws. */
export type OnShared = (shared: { messageId: string; memberId: string; before: string; after: string }) => Promise<void>;

/**
 * The Slack copy of a converted message, as the Hub Chat paste would have sent it: the pasted address out, "Watch it in Hub Chat" and
 * "Open the lesson" in. The change is made as the author (their connected Slack account: Slack only lets whoever posted a message edit it),
 * the same way they edit their own message from the Hub, with Slack's link previews removed so it looks like one shared from the Hub. An author without a live connection, a refused edit, or Slack
 * writes turned off leave the message as it was; the card in the Hub does not depend on it. Logs ids, never text.
 */
export const rewriteInSlack =
  (supabase: SupabaseClient): OnShared =>
  async ({ messageId, memberId, before, after }) => {
    try {
      const repos = createRepos(supabase as unknown as Db);
      const row = await repos.chat.outboxMessage(messageId);
      if (!row || row.deletedAt || row.origin !== "slack" || !row.slackTs) return;
      // The edit names the message's files again, so Slack keeps them with it.
      const fileIds = parseChatFiles(row.files).map((f) => f.id);
      const line = await sharedVideoSlackLine(repos, messageId, row.slackChannelId);
      if (!line) return;
      // The links stand where the address was: text before it stays before, text after it stays after. Slack has no card, so what was
      // shared is named right above the links, as a message sent from the Hub does when it has no text of its own.
      const lessonId = (await repos.chatVideos.lessonIdsOf([messageId])).get(messageId);
      const title = lessonId ? (await repos.courses.lessonById(lessonId))?.title : null;
      const parts = [before.trim(), title ? escapeForSlack(sharedVideoDefaultText(title)) : "", line.replace(/^\n/, ""), after.trim()].filter((part) => part !== "");
      const result = await updateChatMessageInSlack(supabase, { messageId, memberId, body: parts.join("\n"), dropPreviews: true, keepFileIds: fileIds });
      if (!result.ok) console.error("[chat] rewriting the Slack copy of message %s failed: %s", messageId, result.error);
    } catch (error) {
      console.error("[chat] rewriting the Slack copy of message %s failed:", messageId, error instanceof Error ? error.message : error);
    }
  };

export type SlackLinkOutcome = "shared" | "skipped";

/** Converts one message, by its Hub id, if it names a lesson its author may share. Idempotent. */
export async function shareLessonLinkInMessage(repos: Repos, message: { id: string; authorMemberId: string | null; body: string }, onShared?: OnShared): Promise<SlackLinkOutcome> {
  // Slack escapes & in a link's query as &amp;.
  const link = extractLessonLink(message.body.replace(/&amp;/g, "&"), APP_URL);
  const author = message.authorMemberId;
  if (!link || !author) return "skipped";
  if ((await repos.chatVideos.lessonIdsOf([message.id])).has(message.id)) return "skipped";
  if (!(await membersWithFeature(repos, "chat_videos", [author])).has(author)) return "skipped";

  const lesson = await repos.courses.lessonById(link.lessonId);
  const video = lesson?.video_id ? (await repos.courses.videosByIds([lesson.video_id]))[0] : undefined;
  if (!lesson || video?.status !== "ready") return "skipped";

  // An admin in the Hub shares any lesson and may open it to the conversation; anyone else needs the course.
  const userId = (await repos.members.userIdsByMemberId([author])).get(author) ?? null;
  const isAdmin = userId ? await repos.profiles.isAdmin(userId) : false;
  if (!(lesson.state === "open" || isAdmin)) return "skipped";
  if (!canOpenLessons(await loadMemberCourseAccess(repos, { memberId: author, isAdminActing: isAdmin }, lesson.course_id))) return "skipped";

  try {
    await repos.chatVideos.attach(message.id, link.lessonId, link.openToChannel && isAdmin);
  } catch {
    // The message already has its video (another event or the nightly run got there first): fine.
    return "skipped";
  }
  // The text either side of the pasted address, from the message as stored (Slack's escapes kept: it goes back to Slack as it is).
  const raw = extractLessonLink(message.body, APP_URL) ?? link;
  await onShared?.({ messageId: message.id, memberId: author, before: raw.before, after: raw.after }).catch(() => {});
  return "shared";
}

/** The webhook's path: one message by Slack's channel id and timestamp, once it has been projected into chat. Never throws. */
export async function shareLessonLinkBySlackTs(repos: Repos, slackChannelId: string, slackTs: string, onShared?: OnShared): Promise<SlackLinkOutcome> {
  try {
    const channelId = await repos.chat.idBySlackChannel(slackChannelId);
    const messageId = channelId ? await repos.chat.messageIdBySlackTs(channelId, slackTs) : null;
    const message = messageId ? await repos.chat.outboxMessage(messageId) : null;
    if (!message || message.origin !== "slack" || message.deletedAt) return "skipped";
    return await shareLessonLinkInMessage(repos, { id: message.id, authorMemberId: message.authorMemberId, body: message.body }, onShared);
  } catch (error) {
    console.error("[chat] converting a lesson link in Slack message %s/%s failed:", slackChannelId, slackTs, error instanceof Error ? error.message : error);
    return "skipped";
  }
}

/** Slack messages older than this are left as they are: the conversion is for what people are posting now, not for rewriting history. */
export const SLACK_LINK_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const NIGHTLY_LIMIT = 200;

/** The pull-based path (the nightly import): recent Slack messages naming a lesson page that the webhook did not convert. Never throws. */
export async function shareRecentLessonLinks(repos: Repos, onShared?: OnShared): Promise<{ shared: number; looked: number }> {
  try {
    const cutoff = new Date(clock.now() - SLACK_LINK_MAX_AGE_MS).toISOString();
    const candidates = (await repos.chat.slackMessagesLinkingLessons(NIGHTLY_LIMIT)).filter((m) => m.createdAt >= cutoff);
    let shared = 0;
    for (const m of candidates) {
      if ((await shareLessonLinkInMessage(repos, { id: m.id, authorMemberId: m.authorMemberId, body: m.body }, onShared)) === "shared") shared++;
    }
    return { shared, looked: candidates.length };
  } catch (error) {
    console.error("[chat] converting recent lesson links failed:", error instanceof Error ? error.message : error);
    return { shared: 0, looked: 0 };
  }
}
