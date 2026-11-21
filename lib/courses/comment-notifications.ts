import type { OutboundMessage } from "@/lib/channels";
import { APP_URL, ORG_TIMEZONE } from "@/lib/config";
import { clock } from "@/lib/clock";
import type { LessonInfo, ModerationBacklogItem } from "@/lib/data/course-comments";
import type { Repos } from "@/lib/data/repos";
import { membersWithFeature } from "@/lib/features.server";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { createNotifier } from "@/lib/notifications/notify";
import type { NotificationKindId } from "@/lib/notifications/registry";
import { canOpenLessons, resolveCourseAccess } from "@/lib/courses/member";

/**
 * Lesson comment notifications (docs/product/COURSES.md, "Lesson comments", "Notifications"). Every send goes through createNotifier,
 * so each member's per-kind channels apply and the kinds show in Settings and Admin -> Test Notifications. A message says who
 * and where and links to the exact comment; it never holds a comment's text.
 *
 *  - `lesson_comment_reply`: someone replied to your comment (immediate).
 *  - `lesson_comment_instructor_reply`: an instructor replied to you, or in a thread you follow (immediate).
 *  - `lesson_comment_activity`: a daily digest of new comments on the lessons you follow (the cron route).
 *  - `lesson_comment_moderation`: a daily note to staff while reported or held comments wait (the cron route).
 *
 * Rollout: all of it starts in dry run. The `lesson_comment_notifications` flag says who gets a notification for real; for
 * everyone else the sender logs the member id, kind, why, channels and message, and writes no claim, so switching it on starts
 * from a clean slate. A member the kind can't reach on any channel never uses a claim.
 */

export const LESSON_COMMENT_NOTIFICATIONS_FEATURE = "lesson_comment_notifications" as const;

/** The claim kind of the digest's own bookkeeping row: when the digest last ran for real (notification_log, place `job:...`). */
const RUN_KIND = "lesson_comment_activity_run";
const RUN_PLACE = { place: "job:lesson_comment_activity" };
const DIGEST_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A digest never reaches back further than this, however long the job was off. */
const DIGEST_MAX_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Lessons listed in one digest; the rest are "and N more". */
const DIGEST_MAX_LESSONS = 8;

/** The link to a lesson, and to one comment in it (the page scrolls to it and highlights it). Comment ids are Tier 1 and may be shown. */
export const lessonCommentUrl = (info: Pick<LessonInfo, "courseSlug" | "lessonId">, commentId?: string) =>
  `${APP_URL}/courses/${info.courseSlug}/lessons/${info.lessonId}${commentId ? `?comment=${commentId}` : ""}`;

/** In-app notifications about one lesson's thread share this ref, so opening the thread marks them read. */
export const lessonCommentRef = (lessonId: string) => `lesson-comments:${lessonId}`;

/** Slack mrkdwn treats these three characters as markup; a name or title goes into the Slack blocks escaped. */
const escapeSlack = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

type ReplyKind = "lesson_comment_reply" | "lesson_comment_instructor_reply";
export type ReplyAudience = "author" | "follower";

/** The message for a reply: who answered, on which lesson, a link to the reply. No text of the comment. */
export function replyMessage(
  kind: ReplyKind,
  { authorName, lessonTitle, url, lessonId, audience = "author" }: { authorName: string; lessonTitle: string; url: string; lessonId: string; audience?: ReplyAudience },
): OutboundMessage {
  const title =
    kind === "lesson_comment_reply" ? "New reply to your comment" : audience === "author" ? "An instructor answered you" : "An instructor replied in a thread you follow";
  const text =
    kind === "lesson_comment_reply"
      ? `${authorName} replied to your comment on “${lessonTitle}”.`
      : audience === "author"
        ? `${authorName}, one of our instructors, replied to your comment on “${lessonTitle}”.`
        : `${authorName}, one of our instructors, replied in the comments on “${lessonTitle}”, a lesson you follow.`;
  const linkLabel = "Read the reply";
  return {
    title,
    text,
    url,
    linkLabel,
    slackBlocks: [{ type: "section", text: { type: "mrkdwn", text: `${escapeSlack(text)}\n<${url}|${linkLabel}>` } }],
    ref: lessonCommentRef(lessonId),
  };
}

export interface DigestLesson {
  lessonId: string;
  title: string;
  url: string;
  count: number;
}

/** The daily note about new comments on followed lessons: the busiest lessons first, each linked. */
export function activityMessage(lessons: DigestLesson[]): OutboundMessage {
  const total = lessons.reduce((sum, l) => sum + l.count, 0);
  const shown = lessons.slice(0, DIGEST_MAX_LESSONS);
  const rest = lessons.length - shown.length;
  const line = (l: DigestLesson) => `${plural(l.count, "new comment", "new comments")} on “${l.title}”`;
  const text = `${plural(total, "new comment", "new comments")} on ${lessons.length === 1 ? `“${lessons[0].title}”, a lesson you follow` : `${lessons.length} lessons you follow`}${
    lessons.length === 1 ? "." : `: ${shown.map(line).join("; ")}${rest > 0 ? `; and ${rest} more` : ""}.`
  }`;
  const slackLines = shown.map((l) => `• <${l.url}|${escapeSlack(`“${l.title}”`)}>: ${plural(l.count, "new comment", "new comments")}`);
  if (rest > 0) slackLines.push(`and ${rest} more`);
  const linkLabel = "Read the comments";
  return {
    title: "New comments on lessons you follow",
    text,
    url: shown[0].url,
    linkLabel,
    slackBlocks: [{ type: "section", text: { type: "mrkdwn", text: `New comments on lessons you follow:\n${slackLines.join("\n")}` } }],
    ref: lessons.length === 1 ? lessonCommentRef(lessons[0].lessonId) : undefined,
  };
}

/** The staff note: how many comments wait for review, and where. */
export function moderationMessage(backlog: ModerationBacklogItem[]): OutboundMessage {
  const reported = backlog.reduce((sum, c) => sum + c.reported, 0);
  const held = backlog.reduce((sum, c) => sum + c.held, 0);
  const parts = [reported > 0 ? `${reported} reported` : "", held > 0 ? `${held} held for review` : ""].filter(Boolean).join(" and ");
  const text = `${plural(reported + held, "lesson comment is", "lesson comments are")} waiting for a look: ${parts}${backlog.length > 1 ? `, across ${backlog.length} courses` : `, in “${backlog[0].courseTitle}”`}.`;
  const url = backlog.length === 1 ? `${APP_URL}/admin/courses/${backlog[0].courseId}/comments/moderation` : `${APP_URL}/admin/courses`;
  const linkLabel = "Open the review queue";
  const slackLines = backlog.map((c) => `• ${escapeSlack(c.courseTitle)}: ${c.reported} reported, ${c.held} held`);
  return {
    title: "Comments waiting for review",
    text,
    url,
    linkLabel,
    slackBlocks: [{ type: "section", text: { type: "mrkdwn", text: `${escapeSlack(text)}\n${backlog.length > 1 ? `${slackLines.join("\n")}\n` : ""}<${url}|${linkLabel}>` } }],
  };
}

/** Today's date in the community's time zone (`YYYY-MM-DD`): one digest a day is one claim per member per Eastern day. */
export const orgDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** What a send did, for the logs and the cron route's answer. */
export interface CommentNotifyResult {
  sent: { memberId: string; kind: NotificationKindId; channels: string[] }[];
  /** Members it would have gone to if the flag were on for them. */
  dryRun: { memberId: string; kind: NotificationKindId }[];
}

const emptyResult = (): CommentNotifyResult => ({ sent: [], dryRun: [] });

interface Delivery {
  memberId: string;
  kind: NotificationKindId;
  /** The claim key in notification_log under this kind: the same send twice is one send. */
  dedupKey: string;
  /** In words, for the dry-run log. */
  why: string;
  message: OutboundMessage;
}

/** Sends the deliveries of one kind: dry run for members the flag is not on for, else claim, send, and give the claim back when nothing got through. */
async function deliver(repos: Repos, kind: NotificationKindId, deliveries: Delivery[], live: ReadonlySet<string>, now: Date): Promise<CommentNotifyResult> {
  const result = emptyResult();
  if (deliveries.length === 0) return result;
  const notifier = await createNotifier(repos, kind, deliveries.map((d) => d.memberId));
  await Promise.all(
    deliveries.map(async (delivery) => {
      if (!live.has(delivery.memberId)) {
        console.info("[lesson-comment-notifications] dry run: member %s, %s (%s), channels [%s]: %s", delivery.memberId, kind, delivery.why, notifier.channelsFor(delivery.memberId).join(", "), delivery.message.text);
        result.dryRun.push({ memberId: delivery.memberId, kind });
        return;
      }
      // Not reachable on any channel: no claim, so turning a channel on later still sends.
      if (!notifier.canReach(delivery.memberId)) return;
      const claimed = await repos.notificationLog.claim({ memberId: delivery.memberId }, kind, delivery.dedupKey, now);
      if (!claimed) return;
      const channels = await notifier.send(delivery.memberId, delivery.message);
      if (channels.length === 0) {
        await repos.notificationLog.release({ memberId: delivery.memberId }, kind, delivery.dedupKey).catch(() => undefined);
        return;
      }
      result.sent.push({ memberId: delivery.memberId, kind, channels });
    }),
  );
  return result;
}

const merge = (a: CommentNotifyResult, b: CommentNotifyResult): CommentNotifyResult => ({ sent: [...a.sent, ...b.sent], dryRun: [...a.dryRun, ...b.dryRun] });

/**
 * Of these members, who can open each course's lessons now: current access, or staff (who open every course). Ended or upcoming
 * access means no notification: the comments are closed to them. One read of the courses' access rows, however many members.
 */
async function readersOf(repos: Repos, courseIds: string[], memberIds: string[], now: Date): Promise<Map<string, Set<string>>> {
  const wanted = new Set(memberIds);
  const [rows, staff] = await Promise.all([repos.courseProgress.accessOfCourses(courseIds), staffAmong(repos, memberIds)]);
  const readers = new Map<string, Set<string>>(courseIds.map((id) => [id, new Set<string>(staff)]));
  for (const row of rows) {
    if (!wanted.has(row.member_id)) continue;
    if (canOpenLessons(resolveCourseAccess(row, false, now))) readers.get(row.course_id)?.add(row.member_id);
  }
  return readers;
}

/** The admins among these members. */
async function staffAmong(repos: Repos, memberIds: string[]): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const [adminUserIds, userIds] = await Promise.all([repos.profiles.adminIds(), repos.members.userIdsByMemberId(memberIds)]);
  const admins = new Set(adminUserIds);
  return memberIds.filter((id) => {
    const userId = userIds.get(id);
    return Boolean(userId && admins.has(userId));
  });
}

/** Every admin's member id: who the moderation note goes to. */
export async function staffRecipients(repos: Repos): Promise<string[]> {
  const userIds = await repos.profiles.adminIds();
  return [...(await repos.members.idsByUserId(userIds)).values()];
}

/**
 * A reply was posted (or released by staff): tells the author of the comment it answers and, for an instructor's reply, the
 * members following the lesson. Top-level comments notify no one here (they reach followers in the daily digest and staff in the
 * queue). Never throws: a notification must not fail the post. The claim is the comment id, so a repeat (staff approving a held
 * reply that was already sent) sends nothing twice. `repos` must be on a service-role client.
 */
export async function notifyLessonComment(repos: Repos, commentId: string, now = new Date(clock.now())): Promise<CommentNotifyResult> {
  try {
    return await notifyLessonCommentUnsafe(repos, commentId, now);
  } catch (error) {
    console.error("[lesson-comment-notifications] failed for comment %s:", commentId, error instanceof Error ? error.message : error);
    return emptyResult();
  }
}

async function notifyLessonCommentUnsafe(repos: Repos, commentId: string, now: Date): Promise<CommentNotifyResult> {
  const comment = await repos.courseComments.byId(commentId);
  if (!comment || !comment.parentId || comment.deletedAt || comment.hiddenAt || comment.heldAt) return emptyResult();
  const [parent, lessons, authors] = await Promise.all([
    repos.courseComments.byId(comment.parentId),
    repos.courseComments.lessonInfo([comment.lessonId]),
    repos.members.byIds([comment.memberId]),
  ]);
  const lesson = lessons.get(comment.lessonId);
  if (!parent || !lesson) return emptyResult();
  const authorName = authors[0] ? getMemberDisplayName({ name: authors[0].name, display_name: authors[0].displayName }) : "Someone";

  const targets = new Map<string, { kind: ReplyKind; why: string; audience: ReplyAudience }>();
  if (parent.memberId !== comment.memberId && !parent.deletedAt && !parent.hiddenAt) {
    targets.set(parent.memberId, {
      kind: comment.isStaffReply ? "lesson_comment_instructor_reply" : "lesson_comment_reply",
      why: comment.isStaffReply ? "an instructor replied to their comment" : "someone replied to their comment",
      audience: "author",
    });
  }
  if (comment.isStaffReply) {
    const followers = (await repos.courseComments.followers([comment.lessonId])).get(comment.lessonId) ?? [];
    for (const follower of followers) {
      if (follower !== comment.memberId && !targets.has(follower)) {
        targets.set(follower, { kind: "lesson_comment_instructor_reply", why: "an instructor replied in a thread they follow", audience: "follower" });
      }
    }
  }
  if (targets.size === 0) return emptyResult();

  const ids = [...targets.keys()];
  const [readers, live] = await Promise.all([readersOf(repos, [lesson.courseId], ids, now), membersWithFeature(repos, LESSON_COMMENT_NOTIFICATIONS_FEATURE, ids)]);
  const url = lessonCommentUrl(lesson, comment.id);
  const deliveries = ids
    .filter((id) => readers.get(lesson.courseId)?.has(id))
    .map((memberId) => {
      const target = targets.get(memberId)!;
      return {
        memberId,
        kind: target.kind,
        dedupKey: comment.id,
        why: target.why,
        message: replyMessage(target.kind, { authorName, lessonTitle: lesson.title, url, lessonId: lesson.lessonId, audience: target.audience }),
      } satisfies Delivery;
    });

  let result = emptyResult();
  for (const kind of ["lesson_comment_reply", "lesson_comment_instructor_reply"] as const) {
    result = merge(result, await deliver(repos, kind, deliveries.filter((d) => d.kind === kind), live, now));
  }
  return result;
}

/** The member has opened the lesson's thread: its in-app notifications are read. Best effort; the read itself is already saved. */
export async function resolveLessonCommentNotifications(repos: Repos, memberId: string, lessonId: string): Promise<void> {
  try {
    await repos.notifications.resolveInAppByRef(memberId, lessonCommentRef(lessonId));
  } catch (error) {
    console.error("[lesson-comment-notifications] resolving member %s lesson %s failed:", memberId, lessonId, error instanceof Error ? error.message : error);
  }
}

/**
 * The daily digest: for each member following lessons that got new comments since the digest last ran, one note listing those
 * lessons. Their own comments and the ones they were already told about (a reply to them) don't count; a member whose access
 * ended gets nothing. Each member is claimed once per Eastern day. `repos` must be on a service-role client.
 */
export async function sendLessonCommentDigests(repos: Repos, now = new Date(clock.now())): Promise<CommentNotifyResult> {
  const lastRuns = (await repos.notificationLog.sentKeys(RUN_KIND, [RUN_PLACE])).get(RUN_PLACE.place);
  const lastRun = lastRuns && lastRuns.size > 0 ? [...lastRuns].sort().at(-1)! : null;
  const earliest = now.getTime() - DIGEST_MAX_WINDOW_MS;
  const since = new Date(Math.max(earliest, lastRun ? Date.parse(lastRun) : now.getTime() - DIGEST_DEFAULT_WINDOW_MS));
  const activity = await repos.courseComments.activityBetween(since.toISOString(), now.toISOString());
  if (activity.length === 0) return emptyResult();

  const lessonIds = [...new Set(activity.map((a) => a.lessonId))];
  const [followersByLesson, lessons] = await Promise.all([repos.courseComments.followers(lessonIds), repos.courseComments.lessonInfo(lessonIds)]);
  const recipients = [...new Set([...followersByLesson.values()].flat())];
  if (recipients.length === 0) return emptyResult();

  const [readers, live, told] = await Promise.all([
    readersOf(repos, [...new Set([...lessons.values()].map((l) => l.courseId))], recipients, now),
    membersWithFeature(repos, LESSON_COMMENT_NOTIFICATIONS_FEATURE, recipients),
    // A comment that already caused a reply notification for this member is not news again.
    Promise.all([
      repos.notificationLog.sentKeys("lesson_comment_reply", recipients.map((memberId) => ({ memberId }))),
      repos.notificationLog.sentKeys("lesson_comment_instructor_reply", recipients.map((memberId) => ({ memberId }))),
    ]),
  ]);

  const commentsByLesson = new Map<string, typeof activity>();
  for (const comment of activity) commentsByLesson.set(comment.lessonId, [...(commentsByLesson.get(comment.lessonId) ?? []), comment]);

  const day = orgDay(now);
  const deliveries: Delivery[] = [];
  for (const memberId of recipients) {
    const alreadyTold = new Set([...(told[0].get(memberId) ?? []), ...(told[1].get(memberId) ?? [])]);
    const items: DigestLesson[] = [];
    for (const [lessonId, followers] of followersByLesson) {
      const lesson = lessons.get(lessonId);
      if (!lesson || !followers.includes(memberId) || !readers.get(lesson.courseId)?.has(memberId)) continue;
      const count = (commentsByLesson.get(lessonId) ?? []).filter((c) => c.memberId !== memberId && !alreadyTold.has(c.id)).length;
      if (count > 0) items.push({ lessonId, title: lesson.title, url: lessonCommentUrl(lesson), count });
    }
    if (items.length === 0) continue;
    items.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
    deliveries.push({ memberId, kind: "lesson_comment_activity", dedupKey: `day:${day}`, why: `new comments on ${items.length} followed lesson(s)`, message: activityMessage(items) });
  }

  const result = await deliver(repos, "lesson_comment_activity", deliveries, live, now);
  // Remember when it last ran for real, so the next digest starts where this one ended. A dry run leaves no mark.
  if (result.sent.length > 0) await repos.notificationLog.claim(RUN_PLACE, RUN_KIND, now.toISOString(), now);
  return result;
}

/** The daily note to staff while comments are reported or held: one per admin per Eastern day, nothing when the queue is empty. */
export async function sendModerationDigest(repos: Repos, now = new Date(clock.now())): Promise<CommentNotifyResult> {
  const backlog = await repos.courseComments.moderationBacklog();
  if (backlog.length === 0) return emptyResult();
  const staff = await staffRecipients(repos);
  if (staff.length === 0) return emptyResult();
  const live = await membersWithFeature(repos, LESSON_COMMENT_NOTIFICATIONS_FEATURE, staff);
  const message = moderationMessage(backlog);
  const deliveries = staff.map((memberId) => ({ memberId, kind: "lesson_comment_moderation" as const, dedupKey: `day:${orgDay(now)}`, why: "comments wait for review", message }));
  return deliver(repos, "lesson_comment_moderation", deliveries, live, now);
}
