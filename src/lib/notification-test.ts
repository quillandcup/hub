import { CHANNEL_ADAPTERS, CHANNELS, type ChannelId, type OutboundMessage } from "@/lib/channels";
import type { Repos } from "@/lib/data/repos";
import { bigSisterMessageForMentor, bigSisterMessageForNewMember } from "@/lib/mentorship-intro";
import { loadIntroChannelId } from "@/lib/newcomer-signals";
import { introNudgeMessage, prickleNudgeMessage } from "@/lib/member-reminders";
import { chatNotificationMessage } from "@/lib/chat/notifications";
import { checkinMessage, checkoutMessage } from "@/lib/prickle-checkin-dms";
import { NOTIFICATION_SETTINGS_PATH } from "@/lib/notifications/notify";
import { joinAt, loadPrickleJoinSettings } from "@/lib/prickle-join";
import { APP_URL } from "@/lib/config";
import { digestMessage } from "@/lib/changelog/digest";
import { bookVisibilityNoticeMessage } from "@/lib/book-visibility-notice";
import { listProductChangelog } from "@/lib/changelog";
import type { NotificationKindId } from "@/lib/notifications/registry";
import { activityMessage, lessonCommentUrl, moderationMessage, replyMessage } from "@/lib/courses/comment-notifications";
import type { LessonInfo } from "@/lib/data/course-comments";

type TestSendRepos = Repos;

/**
 * Admin "send me a test": every notification kind, on every channel, to the admin's own member
 * record. It skips preferences and feature flags' opt-ins (the admin asked for it just now) but
 * not what a channel needs to reach someone (a Slack match, an email address, a subscribed device,
 * the in-app feature flag), and it says why when it can't. Outside production Slack and email are
 * redirected to the dev address (SLACK_TEST_MODE / EMAIL_TEST_MODE), as for any send.
 *
 * The messages are the real ones, built by the same functions the features use, with sample data
 * where they'd need a member or prickle, and marked "[Test]".
 */

/** Why a channel couldn't reach the admin, for when its address lookup comes back empty. */
export const UNREACHABLE_REASON: Record<ChannelId, string> = {
  slack: "No Slack account is matched to your member record.",
  in_app: "The In-app notifications preview isn't on for you (Settings → Previews).",
  web_push: "No device of yours has Browser notifications turned on (Settings → Notifications), or the Browser notifications preview is off.",
  email: "Your member record has no email address.",
};

const TEST_PREFIX = "[Test] ";

/** The prickle a check-in or check-out sample is about: the next one, else the latest, else a stand-in. */
async function samplePrickle(repos: TestSendRepos, now: Date) {
  const prickle = await repos.prickles.nextOrMostRecent(now.toISOString());
  if (prickle?.type?.name) return { id: prickle.id, typeName: prickle.type.name, startTime: prickle.startTime, endTime: prickle.endTime };
  return { id: "sample", typeName: "Sprint Prickle", startTime: now.toISOString(), endTime: new Date(now.getTime() + 60 * 60 * 1000).toISOString() };
}

const SAMPLE_COMMENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * What the lesson comment samples point at, so a test message opens something real: a published course's open lesson (the one
 * with the latest reply, else the latest comment, else the first lesson) and that comment's id when there is one. Null when no
 * published course has a lesson; the samples then fall back to the course list. Ids shown are the comment's (Tier 1) and the lesson's.
 */
async function sampleLessonComment(repos: TestSendRepos, now: Date): Promise<{ info: LessonInfo; commentId?: string } | null> {
  const courses = await repos.courses.courses({ isDraft: false });
  if (courses.length === 0) return null;
  const lessons = await repos.courses.lessonsOf(courses.map((c) => c.id));
  if (lessons.length === 0) return null;
  const lessonIds = new Set(lessons.map((l) => l.id));
  const activity = (await repos.courseComments.activityBetween(new Date(now.getTime() - SAMPLE_COMMENT_WINDOW_MS).toISOString(), now.toISOString()))
    .filter((c) => lessonIds.has(c.lessonId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const comment = activity.find((c) => c.parentId) ?? activity[0];
  const lessonId = comment?.lessonId ?? lessons[0].id;
  const info = (await repos.courseComments.lessonInfo([lessonId])).get(lessonId);
  return info ? { info, commentId: comment?.id } : null;
}

const marked = (message: OutboundMessage): OutboundMessage => ({
  ...message,
  text: TEST_PREFIX + message.text,
  title: message.title ? TEST_PREFIX + message.title : undefined,
});

/**
 * The sample messages for one kind: usually one, two when it goes to two different people (Big Sisters).
 * Marked as tests by default (the admin test send); `{ test: false }` gives them as a member receives them,
 * which is what the notification mockups in tests/demo/ draw.
 */
export async function sampleMessages(
  repos: TestSendRepos,
  kind: NotificationKindId,
  now = new Date(),
  { test = true }: { test?: boolean } = {},
): Promise<OutboundMessage[]> {
  const mark = (message: OutboundMessage) => (test ? marked(message) : message);
  switch (kind) {
    case "prickle_checkin":
      return [
        checkinMessage(await samplePrickle(repos, now), null, {
          test,
          join: joinAt(await loadPrickleJoinSettings(repos), now),
        }),
      ];
    case "prickle_checkout":
      return [checkoutMessage(await samplePrickle(repos, now), null, [], { test })];
    case "intro_nudge":
      return [mark(introNudgeMessage(await loadIntroChannelId(repos)))];
    case "prickle_nudge":
      return [mark(prickleNudgeMessage("first"))];
    case "changelog_digest":
      return [mark(digestMessage(listProductChangelog().slice(0, 1)))];
    case "book_visibility_notice":
      return [mark(bookVisibilityNoticeMessage(1))];
    // Chat samples link to the chat list, not a conversation: there is no real one to name.
    case "chat_dm":
      return [mark(chatNotificationMessage("chat_dm", { authorName: "Marlow", channelKind: "dm", channelName: null, channelId: null, threadRootId: null }))];
    case "chat_mention":
      return [mark(chatNotificationMessage("chat_mention", { authorName: "Marlow", channelKind: "channel", channelName: "writing-sprints", channelId: null, threadRootId: null }))];
    case "chat_channel_message":
      return [mark(chatNotificationMessage("chat_channel_message", { authorName: "Marlow", channelKind: "channel", channelName: "writing-sprints", channelId: null, threadRootId: null }))];
    // Lesson comment samples link to a real lesson (and its latest comment) with the same builders the senders use; without a
    // published lesson they fall back to the course list and a stand-in review link.
    case "lesson_comment_reply":
    case "lesson_comment_instructor_reply": {
      const sample = await sampleLessonComment(repos, now);
      return [
        mark(
          replyMessage(kind, {
            authorName: kind === "lesson_comment_reply" ? "Marlow" : "Linden",
            lessonTitle: sample?.info.title ?? "Writing your first scene",
            url: sample ? lessonCommentUrl(sample.info, sample.commentId) : `${APP_URL}/courses`,
            lessonId: sample?.info.lessonId ?? "sample",
          }),
        ),
      ];
    }
    case "lesson_comment_activity": {
      const sample = await sampleLessonComment(repos, now);
      return [
        mark(
          activityMessage([
            {
              lessonId: sample?.info.lessonId ?? "sample",
              title: sample?.info.title ?? "Writing your first scene",
              url: sample ? lessonCommentUrl(sample.info) : `${APP_URL}/courses`,
              count: 3,
            },
          ]),
        ),
      ];
    }
    case "lesson_comment_moderation": {
      const sample = await sampleLessonComment(repos, now);
      // Two stand-in courses make the note link to the course list (a real page) when there is no real course to review.
      const backlog = sample
        ? [{ courseId: sample.info.courseId, courseTitle: sample.info.courseTitle, reported: 1, held: 2 }]
        : [
            { courseId: "sample", courseTitle: "Story Basics", reported: 1, held: 1 },
            { courseId: "sample-2", courseTitle: "Revision Basics", reported: 0, held: 1 },
          ];
      return [mark(moderationMessage(backlog))];
    }
    case "big_sister_match":
      return [mark(bigSisterMessageForNewMember("Marlow", "sample")), mark(bigSisterMessageForMentor("Marlow", "Linden", "sample"))];
  }
}

export type TestSendResult = { ok: true; sent: number } | { ok: false; error: string };

/**
 * Sends the kind's sample message(s) to `memberId` on `channel`. Uses the channel adapter directly
 * (not the notifier) so a failure comes back with its reason instead of only being logged.
 */
export async function sendTestNotification(
  repos: TestSendRepos,
  memberId: string,
  kind: NotificationKindId,
  channel: ChannelId,
  now = new Date()
): Promise<TestSendResult> {
  const adapter = CHANNEL_ADAPTERS[channel];
  const address = (await adapter.resolveAddresses(repos, [memberId])).get(memberId);
  if (!address) return { ok: false, error: UNREACHABLE_REASON[channel] };

  const messages = await sampleMessages(repos, kind, now);
  try {
    for (const message of messages) {
      await adapter.send(
        address,
        { ...message, footerLinks: [{ label: "Notification settings", url: `${APP_URL}${NOTIFICATION_SETTINGS_PATH}` }] },
        { kind, memberId }
      );
    }
  } catch (error) {
    const label = CHANNELS.find((c) => c.id === channel)!.label;
    return { ok: false, error: `${label} failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, sent: messages.length };
}
