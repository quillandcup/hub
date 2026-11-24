import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { APP_URL } from "@/lib/config";

vi.mock("@/lib/slack", () => ({ sendSlackDM: vi.fn(async () => {}) }));
vi.mock("@/lib/slack-member-ids", () => ({ resolveSlackUserIds: async () => new Map() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert: vi.fn(async () => {}) }));

// The in-app channel writes through createRepos(createServiceRoleClient()): hand it the in-memory repositories.
let dataset: InMemoryDataset;
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const {
  activityMessage,
  lessonCommentRef,
  lessonCommentUrl,
  mentionMessage,
  moderationMessage,
  notifyLessonComment,
  orgDay,
  replyMessage,
  resolveLessonCommentNotifications,
  sendLessonCommentDigests,
  sendModerationDigest,
} = await import("@/lib/courses/comment-notifications");
const { countUnread } = await import("@/lib/courses/comments");

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const OTHER_LESSON = "les_AAAAAAAAAAA2";
const NOW = Date.parse("2027-03-02T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const ASKER = "mbr_AAAAAAAAAAA1";
const REPLIER = "mbr_AAAAAAAAAAA2";
const FOLLOWER = "mbr_AAAAAAAAAAA3";
const STAFF = "mbr_AAAAAAAAAAA4";
const ENDED = "mbr_AAAAAAAAAAA5";
const NAMES: Record<string, string> = { [ASKER]: "Ada Example", [REPLIER]: "Bea & <Co> Example", [FOLLOWER]: "Cy Example", [STAFF]: "Sam Staff", [ENDED]: "Eli Example" };

const flag = (enabled: boolean) => ({ feature_key: "lesson_comment_notifications", enabled_globally: enabled, created_at: "2027-01-01T00:00:00Z", updated_at: "2027-01-01T00:00:00Z" });

function world({ flagOn = true, prefs = [] as { memberId: string; kind: string; channel: string; enabled: boolean }[] } = {}) {
  dataset = new InMemoryDataset({
    members: Object.entries(NAMES).map(([id, name]) => ({ id, name, firstJoinedAt: "2024-01-01", userId: `u-${id}` })),
    userProfiles: [{ id: `u-${STAFF}`, email: "staff@example.test", role: "admin" }],
    featureFlags: [flag(flagOn)],
    notificationPreferences: prefs,
    courses: [{ id: COURSE, slug: "story-basics", title: "Story Basics" } as never],
    courseLessons: [
      { id: LESSON, course_id: COURSE, title: "Writing & <your> first scene" } as never,
      { id: OTHER_LESSON, course_id: COURSE, title: "Second lesson" } as never,
    ],
    courseAccess: [
      ...[ASKER, REPLIER, FOLLOWER].map((member_id) => ({ member_id, course_id: COURSE, starts_at: "2027-01-01T00:00:00Z", ends_at: null, origin: "purchase" })),
      { member_id: ENDED, course_id: COURSE, starts_at: "2026-01-01T00:00:00Z", ends_at: "2027-02-01T00:00:00Z", origin: "purchase" },
    ],
  });
  repos = createInMemoryRepos(dataset);
}

const post = (memberId: string, body: string, parentId: string | null = null, extra: { isInstructorReply?: boolean; held?: boolean; lessonId?: string } = {}) =>
  repos.courseComments.create({ lessonId: extra.lessonId ?? LESSON, memberId, parentId, body, isInstructorReply: extra.isInstructorReply ?? false, held: extra.held });

const notifications = (memberId: string) => dataset.inAppNotifications.filter((n) => n.memberId === memberId);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  world();
});

afterEach(() => vi.useRealTimers());

describe("the messages", () => {
  const info = { courseSlug: "story-basics", lessonId: LESSON };

  it("links to the exact comment, never previews, and says who answered without the answer", () => {
    const url = lessonCommentUrl(info, "cmnt_AAAAAAAAAAA7");
    expect(url).toBe(`${APP_URL}/courses/story-basics/lessons/${LESSON}?comment=cmnt_AAAAAAAAAAA7`);
    const message = replyMessage("lesson_comment_reply", { authorName: "Bea & <Co>", lessonTitle: "Scene & <one>", url, lessonId: LESSON });
    expect(message.text).toBe("Bea & <Co> replied to your comment on “Scene & <one>”.");
    expect(message.url).toBe(url);
    expect(message.ref).toBe(lessonCommentRef(LESSON));
    // Slack text is escaped, the plain text is as typed.
    const slack = message.slackBlocks![0].text.text as string;
    expect(slack).toContain("Bea &amp; &lt;Co&gt; replied to your comment on “Scene &amp; &lt;one&gt;”.");
    expect(slack).toContain(`<${url}|Read the reply>`);
  });

  it("names an instructor's reply for the author and for a follower differently", () => {
    const author = replyMessage("lesson_comment_instructor_reply", { authorName: "Sam", lessonTitle: "L", url: "u", lessonId: LESSON, audience: "author" });
    const follower = replyMessage("lesson_comment_instructor_reply", { authorName: "Sam", lessonTitle: "L", url: "u", lessonId: LESSON, audience: "follower" });
    expect(author.text).toBe("Sam, one of our instructors, replied to your comment on “L”.");
    expect(follower.text).toBe("Sam, one of our instructors, replied in the comments on “L”, a lesson you follow.");
    expect(author.title).toBe("An instructor answered you");
    expect(follower.title).toBe("An instructor replied in a thread you follow");
  });

  it("lists the busiest lessons of a digest, each linked, and counts the rest", () => {
    const lessons = Array.from({ length: 10 }, (_, i) => ({ lessonId: `l${i}`, title: `Lesson <${i}> & more`, url: `https://x/${i}`, count: 10 - i }));
    const message = activityMessage(lessons);
    expect(message.text).toContain("55 new comments on 10 lessons you follow: 10 new comments on “Lesson <0> & more”");
    expect(message.text).toContain("and 2 more");
    expect(message.url).toBe("https://x/0");
    expect(message.ref).toBeUndefined();
    const slack = message.slackBlocks![0].text.text as string;
    expect(slack).toContain("• <https://x/0|“Lesson &lt;0&gt; &amp; more”>: 10 new comments");
    expect(slack).toContain("and 2 more");
    expect(slack).not.toContain("https://x/9");
  });

  it("says it simply for one lesson and carries its ref", () => {
    const message = activityMessage([{ lessonId: LESSON, title: "One", url: "https://x/1", count: 1 }]);
    expect(message.text).toBe("1 new comment on “One”, a lesson you follow.");
    expect(message.ref).toBe(lessonCommentRef(LESSON));
  });

  it("tells staff what waits, with a link to the course when it is one, else to the courses", () => {
    const one = moderationMessage([{ courseId: COURSE, courseTitle: "Story & <Basics>", reported: 2, held: 1 }]);
    expect(one.text).toBe("3 lesson comments are waiting for a look: 2 reported and 1 held for review, in “Story & <Basics>”.");
    expect(one.url).toBe(`${APP_URL}/admin/courses/${COURSE}/comments/moderation`);
    const many = moderationMessage([
      { courseId: COURSE, courseTitle: "A", reported: 1, held: 0 },
      { courseId: "crs_AAAAAAAAAAA2", courseTitle: "B", reported: 0, held: 1 },
    ]);
    expect(many.text).toBe("2 lesson comments are waiting for a look: 1 reported and 1 held for review, across 2 courses.");
    expect(many.url).toBe(`${APP_URL}/admin/courses`);
    expect(moderationMessage([{ courseId: COURSE, courseTitle: "A", reported: 0, held: 1 }]).text).toContain("1 lesson comment is waiting");
  });

  it("gives a day in the community's time zone", () => {
    expect(orgDay(new Date("2027-03-03T03:30:00Z"))).toBe("2027-03-02");
    expect(orgDay(new Date("2027-03-03T05:30:00Z"))).toBe("2027-03-03");
  });
});

describe("notifyLessonComment (replies)", () => {
  it("tells the author of a comment about a reply, once, with a link to the reply and none of its text", async () => {
    const question = await post(ASKER, "A question");
    const reply = await post(REPLIER, "Secret answer text", question.id);

    const result = await notifyLessonComment(repos, reply.id);

    expect(result.sent).toEqual([{ memberId: ASKER, kind: "lesson_comment_reply", channels: ["in_app"] }]);
    expect(notifications(ASKER)).toEqual([
      expect.objectContaining({ kind: "lesson_comment_reply", text: "Bea & <Co> Example replied to your comment on “Writing & <your> first scene”.", ref: lessonCommentRef(LESSON) }),
    ]);
    expect(notifications(ASKER)[0].url).toContain(`?comment=${reply.id}`);
    expect(JSON.stringify(dataset.inAppNotifications)).not.toContain("Secret answer");
    expect(dataset.notificationLog).toEqual([expect.objectContaining({ recipient: ASKER, kind: "lesson_comment_reply", dedupKey: reply.id })]);

    expect((await notifyLessonComment(repos, reply.id)).sent).toEqual([]);
    expect(notifications(ASKER)).toHaveLength(1);
  });

  it("tells the member who wrote an imported comment about a reply, like any comment, and an instructor's reply reaches followers", async () => {
    const [imported] = await repos.courseComments.upsertImported("kajabi", [
      { lessonId: LESSON, sourceKey: "k/1", parentId: null, memberId: ASKER, isInstructorReply: false, body: "Old question", createdAt: "2025-01-01T00:00:00.000Z", deletedAt: null },
    ]);
    await repos.courseComments.setFollowing(FOLLOWER, LESSON, true);
    const plain = await post(REPLIER, "A member's reply", imported.id);
    const instructor = await post(STAFF, "An instructor's reply", imported.id, { isInstructorReply: true });

    expect((await notifyLessonComment(repos, plain.id)).sent).toEqual([{ memberId: ASKER, kind: "lesson_comment_reply", channels: ["in_app"] }]);
    const result = await notifyLessonComment(repos, instructor.id);

    expect(result.sent).toEqual(expect.arrayContaining([{ memberId: FOLLOWER, kind: "lesson_comment_instructor_reply", channels: ["in_app"] }]));
  });

  it("tells no one about a top-level comment, a reply to yourself, a held or deleted comment, or one that is not there", async () => {
    const question = await post(ASKER, "A question");
    const own = await post(ASKER, "Replying to myself", question.id);
    const held = await post(REPLIER, "Held reply", question.id, { held: true });
    const deleted = await post(REPLIER, "Soon gone", question.id);
    await repos.courseComments.softDelete(deleted.id, REPLIER, new Date(NOW).toISOString());

    for (const id of [question.id, own.id, held.id, deleted.id, "cmnt_ZZZZZZZZZZZZ"]) {
      expect((await notifyLessonComment(repos, id)).sent).toEqual([]);
    }
    expect(dataset.inAppNotifications).toEqual([]);
    expect(dataset.notificationLog).toEqual([]);
  });

  it("tells them once staff release a held reply, and not about a reply to a deleted or hidden comment", async () => {
    const question = await post(ASKER, "A question");
    const held = await post(REPLIER, "Held reply", question.id, { held: true });
    await repos.courseComments.moderate(held.id, "approve", STAFF);

    expect((await notifyLessonComment(repos, held.id)).sent).toHaveLength(1);

    const hiddenQuestion = await post(ASKER, "Hidden question");
    await repos.courseComments.moderate(hiddenQuestion.id, "hide", STAFF);
    const reply = await post(REPLIER, "Reply to hidden", hiddenQuestion.id);
    expect((await notifyLessonComment(repos, reply.id)).sent).toEqual([]);
  });

  it("tells the question's author and the lesson's followers about an instructor's reply, as the kind they can mute on its own", async () => {
    const question = await post(ASKER, "A question");
    await repos.courseComments.setFollowing(FOLLOWER, LESSON, true);
    await repos.courseComments.setFollowing(REPLIER, LESSON, false);
    const answer = await post(STAFF, "Instructor answer", question.id, { isInstructorReply: true });

    const result = await notifyLessonComment(repos, answer.id);

    expect(result.sent.map((s) => [s.memberId, s.kind]).sort()).toEqual([
      [ASKER, "lesson_comment_instructor_reply"],
      [FOLLOWER, "lesson_comment_instructor_reply"],
    ]);
    expect(notifications(ASKER)[0].text).toBe("Sam Staff, one of our instructors, replied to your comment on “Writing & <your> first scene”.");
    expect(notifications(FOLLOWER)[0].text).toContain("a lesson you follow");
    expect(notifications(REPLIER)).toEqual([]);
    expect(notifications(STAFF)).toEqual([]);
  });

  it("treats a reply by staff who do not teach the course as an ordinary reply: the plain kind, and the followers are not told", async () => {
    const question = await post(ASKER, "A question");
    await repos.courseComments.setFollowing(FOLLOWER, LESSON, true);
    // The flag is what the server stored when the reply was posted: staff who are not instructors of the course never carry it.
    const reply = await post(STAFF, "A staff member replying like any member", question.id, { isInstructorReply: false });

    const result = await notifyLessonComment(repos, reply.id);

    expect(result.sent.map((s) => [s.memberId, s.kind])).toEqual([[ASKER, "lesson_comment_reply"]]);
    expect(notifications(ASKER)[0].text).not.toContain("instructor");
    expect(notifications(FOLLOWER)).toEqual([]);
  });

  it("does not use the instructor kind's switch for another member's reply, and honors a member who turned it off", async () => {
    world({ prefs: [{ memberId: ASKER, kind: "lesson_comment_reply", channel: "in_app", enabled: false }] });
    const question = await post(ASKER, "A question");
    const reply = await post(REPLIER, "A reply", question.id);

    const result = await notifyLessonComment(repos, reply.id);

    expect(result).toEqual({ sent: [], dryRun: [] });
    // Nobody could be reached, so nothing was claimed: turning it back on later still sends.
    expect(dataset.notificationLog).toEqual([]);
  });

  it("leaves out a member whose access to the course ended", async () => {
    const question = await post(ENDED, "From before access ended");
    const reply = await post(REPLIER, "A reply", question.id);
    expect((await notifyLessonComment(repos, reply.id)).sent).toEqual([]);
    expect(dataset.inAppNotifications).toEqual([]);
  });

  it("only logs while the flag is off: who, which kind, why and the message, with nothing sent or claimed", async () => {
    world({ flagOn: false });
    const question = await post(ASKER, "A question");
    const reply = await post(REPLIER, "Secret answer text", question.id);

    const result = await notifyLessonComment(repos, reply.id);

    expect(result).toEqual({ sent: [], dryRun: [{ memberId: ASKER, kind: "lesson_comment_reply" }] });
    expect(dataset.inAppNotifications).toEqual([]);
    expect(dataset.notificationLog).toEqual([]);
    const logged = vi.mocked(console.info).mock.calls.flat().map(String).join(" ");
    expect(logged).toContain(ASKER);
    expect(logged).toContain("lesson_comment_reply");
    expect(logged).toContain("replied to your comment");
    expect(logged).not.toContain("Secret answer");
  });

  it("never throws: a failure is logged and the post goes on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.courseComments, "byId").mockRejectedValue(new Error("db down"));
    await expect(notifyLessonComment(repos, "cmnt_AAAAAAAAAAA1")).resolves.toEqual({ sent: [], dryRun: [] });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("mentions", () => {
  const token = (id: string) => `@[${id}]`;

  it("words a mention with who and where, a link to the comment, no text, and Slack escaped", () => {
    const url = lessonCommentUrl({ courseSlug: "story-basics", lessonId: LESSON }, "cmnt_AAAAAAAAAAA7");
    const message = mentionMessage({ authorName: "Bea & <Co>", lessonTitle: "Scene & <one>", url, lessonId: LESSON });
    expect(message.text).toBe("Bea & <Co> mentioned you in a comment on “Scene & <one>”.");
    expect(message.url).toBe(url);
    expect(message.ref).toBe(lessonCommentRef(LESSON));
    expect(message.slackBlocks![0].text.text as string).toContain("Bea &amp; &lt;Co&gt; mentioned you in a comment on “Scene &amp; &lt;one&gt;”.");
  });

  it("tells a mentioned member about a top-level comment, once, without the text", async () => {
    const comment = await post(ASKER, `Hello ${token(FOLLOWER)}, a secret question`);

    const result = await notifyLessonComment(repos, comment.id);

    expect(result.sent).toEqual([{ memberId: FOLLOWER, kind: "lesson_comment_mention", channels: ["in_app"] }]);
    expect(notifications(FOLLOWER)).toEqual([
      expect.objectContaining({ kind: "lesson_comment_mention", text: "Ada Example mentioned you in a comment on “Writing & <your> first scene”." }),
    ]);
    expect(notifications(FOLLOWER)[0].url).toContain(`?comment=${comment.id}`);
    expect(JSON.stringify(dataset.inAppNotifications)).not.toContain("secret question");
    expect((await notifyLessonComment(repos, comment.id)).sent).toEqual([]);
    expect(notifications(FOLLOWER)).toHaveLength(1);
  });

  it("does not tell the author who mentions themselves, a member whose access ended, or anyone about a held comment", async () => {
    const own = await post(ASKER, `Note to self ${token(ASKER)}`);
    const ended = await post(ASKER, `Hi ${token(ENDED)}`);
    const held = await post(ASKER, `Hi ${token(FOLLOWER)}`, null, { held: true });

    for (const id of [own.id, ended.id, held.id]) expect((await notifyLessonComment(repos, id)).sent).toEqual([]);
    expect(dataset.inAppNotifications).toEqual([]);
    // Once staff release the held comment, the mention goes out.
    await repos.courseComments.moderate(held.id, "approve", STAFF);
    expect((await notifyLessonComment(repos, held.id)).sent).toHaveLength(1);
  });

  it("tells staff when they are mentioned, and a mention in a reply reaches the one replied to only once", async () => {
    const question = await post(ASKER, "A question");
    const reply = await post(REPLIER, `${token(ASKER)} and ${token(STAFF)} and ${token(FOLLOWER)}`, question.id);

    const result = await notifyLessonComment(repos, reply.id);

    expect(result.sent.map((s) => [s.memberId, s.kind]).sort()).toEqual([
      [ASKER, "lesson_comment_reply"],
      [FOLLOWER, "lesson_comment_mention"],
      [STAFF, "lesson_comment_mention"],
    ]);
  });

  it("on an edit sends just the new mentions, and not the reply again", async () => {
    const question = await post(ASKER, "A question");
    const reply = await post(REPLIER, "A reply", question.id);
    await notifyLessonComment(repos, reply.id);
    await repos.courseComments.edit(reply.id, `A reply for ${token(FOLLOWER)} and ${token(ASKER)}`, new Date(NOW).toISOString());

    const result = await notifyLessonComment(repos, reply.id, new Date(NOW), "mentions");

    expect(result.sent.map((s) => [s.memberId, s.kind])).toEqual([[FOLLOWER, "lesson_comment_mention"]]);
    expect(notifications(ASKER)).toHaveLength(1);
  });

  it("only logs while the flag is off, with the message and no text", async () => {
    world({ flagOn: false });
    const comment = await post(ASKER, `Hi ${token(FOLLOWER)} private words`);

    const result = await notifyLessonComment(repos, comment.id);

    expect(result).toEqual({ sent: [], dryRun: [{ memberId: FOLLOWER, kind: "lesson_comment_mention" }] });
    expect(dataset.inAppNotifications).toEqual([]);
    expect(dataset.notificationLog).toEqual([]);
    const logged = vi.mocked(console.info).mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("lesson_comment_mention");
    expect(logged).not.toContain("private words");
  });
});

describe("resolveLessonCommentNotifications", () => {
  it("marks the thread's in-app notifications read, and survives a failure", async () => {
    const question = await post(ASKER, "A question");
    await notifyLessonComment(repos, (await post(REPLIER, "A reply", question.id)).id);
    expect(notifications(ASKER)[0].readAt ?? null).toBeNull();

    await resolveLessonCommentNotifications(repos, ASKER, LESSON);
    expect(notifications(ASKER)[0].readAt).toBeTruthy();

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.notifications, "resolveInAppByRef").mockRejectedValue(new Error("nope"));
    await expect(resolveLessonCommentNotifications(repos, ASKER, LESSON)).resolves.toBeUndefined();
  });
});

describe("sendLessonCommentDigests", () => {
  it("tells a follower once a day about new comments by others, linking the lesson", async () => {
    await repos.courseComments.setFollowing(FOLLOWER, LESSON, true);
    await post(ASKER, "A question");
    await post(REPLIER, "Another question");
    await post(FOLLOWER, "My own comment");
    await post(REPLIER, "On a lesson not followed", null, { lessonId: OTHER_LESSON });
    vi.setSystemTime(NOW + 60_000);

    const result = await sendLessonCommentDigests(repos);

    expect(result.sent).toEqual([{ memberId: FOLLOWER, kind: "lesson_comment_activity", channels: ["in_app"] }]);
    expect(notifications(FOLLOWER)).toEqual([
      expect.objectContaining({ text: "2 new comments on “Writing & <your> first scene”, a lesson you follow.", url: expect.stringContaining(`/courses/story-basics/lessons/${LESSON}`) }),
    ]);
    expect(notifications(FOLLOWER)[0].url).not.toContain("?comment=");
    expect(notifications(ASKER)).toEqual([]);

    // The same day again sends nothing more.
    expect((await sendLessonCommentDigests(repos)).sent).toEqual([]);
    expect(notifications(FOLLOWER)).toHaveLength(1);
  });

  it("starts the next digest where the last ended, so a comment is told once", async () => {
    await repos.courseComments.setFollowing(FOLLOWER, LESSON, true);
    await post(ASKER, "Monday question");
    vi.setSystemTime(NOW + 60_000);
    expect((await sendLessonCommentDigests(repos)).sent).toHaveLength(1);

    vi.setSystemTime(NOW + DAY);
    await post(REPLIER, "Tuesday question");
    vi.setSystemTime(NOW + DAY + 60_000);
    const next = await sendLessonCommentDigests(repos);

    expect(next.sent).toHaveLength(1);
    expect(notifications(FOLLOWER).map((n) => n.text)).toEqual([
      "1 new comment on “Writing & <your> first scene”, a lesson you follow.",
      "1 new comment on “Writing & <your> first scene”, a lesson you follow.",
    ]);
    // Nothing new since: no note, even a day later.
    vi.setSystemTime(NOW + 2 * DAY + 60_000);
    expect((await sendLessonCommentDigests(repos)).sent).toEqual([]);
  });

  it("does not repeat news the member already had as a reply to them", async () => {
    await repos.courseComments.setFollowing(ASKER, LESSON, true);
    const question = await post(ASKER, "A question");
    const reply = await post(REPLIER, "A reply", question.id);
    await notifyLessonComment(repos, reply.id);
    vi.setSystemTime(NOW + 60_000);

    const result = await sendLessonCommentDigests(repos);

    expect(result.sent).toEqual([]);
    expect(notifications(ASKER)).toHaveLength(1);
  });

  it("leaves out unfollowed lessons, members whose access ended, and held, hidden or deleted comments", async () => {
    await repos.courseComments.setFollowing(ENDED, LESSON, true);
    await repos.courseComments.setFollowing(FOLLOWER, LESSON, false);
    await post(ASKER, "Fine");
    vi.setSystemTime(NOW + 60_000);
    expect((await sendLessonCommentDigests(repos)).sent).toEqual([]);

    await repos.courseComments.setFollowing(FOLLOWER, LESSON, true);
    await post(ASKER, "Held", null, { held: true });
    const gone = await post(ASKER, "Hidden");
    await repos.courseComments.moderate(gone.id, "hide", STAFF);
    vi.setSystemTime(NOW + 120_000);
    // Only "Fine" counts (made before this window began is still inside the first, never-run window).
    const result = await sendLessonCommentDigests(repos);
    expect(notifications(FOLLOWER)[0]?.text).toContain("1 new comment");
    expect(result.sent).toHaveLength(1);
  });

  it("only logs while the flag is off, and leaves no mark so switching it on starts clean", async () => {
    world({ flagOn: false });
    await repos.courseComments.setFollowing(FOLLOWER, LESSON, true);
    await post(ASKER, "A question");
    vi.setSystemTime(NOW + 60_000);

    const result = await sendLessonCommentDigests(repos);

    expect(result).toEqual({ sent: [], dryRun: [{ memberId: FOLLOWER, kind: "lesson_comment_activity" }] });
    expect(dataset.inAppNotifications).toEqual([]);
    expect(dataset.notificationLog).toEqual([]);
  });

  it("does nothing when there is no news or nobody follows", async () => {
    expect(await sendLessonCommentDigests(repos)).toEqual({ sent: [], dryRun: [] });
    await post(ASKER, "Nobody follows this lesson but its author");
    vi.setSystemTime(NOW + 60_000);
    // The author follows by posting (the action does it); here only explicit follows exist.
    expect(await sendLessonCommentDigests(repos)).toEqual({ sent: [], dryRun: [] });
  });

  it("never reaches back more than three days after a long stop", async () => {
    await repos.courseComments.setFollowing(FOLLOWER, LESSON, true);
    await post(ASKER, "Ten days ago");
    vi.setSystemTime(NOW + 10 * DAY);
    expect(await sendLessonCommentDigests(repos)).toEqual({ sent: [], dryRun: [] });
  });
});

describe("sendModerationDigest", () => {
  it("tells each admin once a day while comments wait, and nothing when the queue is empty", async () => {
    expect(await sendModerationDigest(repos)).toEqual({ sent: [], dryRun: [] });

    const held = await post(ASKER, "Held", null, { held: true });
    const reported = await post(ASKER, "Reported");
    await repos.courseComments.report({ commentId: reported.id, reporterId: REPLIER, reason: "Spam" });

    const result = await sendModerationDigest(repos);

    expect(result.sent).toEqual([{ memberId: STAFF, kind: "lesson_comment_moderation", channels: ["in_app"] }]);
    expect(notifications(STAFF)).toEqual([
      expect.objectContaining({ text: "2 lesson comments are waiting for a look: 1 reported and 1 held for review, in “Story Basics”.", url: expect.stringContaining(`/admin/courses/${COURSE}/comments/moderation`) }),
    ]);
    expect(JSON.stringify(dataset.inAppNotifications)).not.toContain("Spam");
    expect(notifications(ASKER)).toEqual([]);
    expect((await sendModerationDigest(repos)).sent).toEqual([]);

    // The next Eastern day, still waiting: told again. Once cleared: nothing.
    vi.setSystemTime(NOW + DAY);
    expect((await sendModerationDigest(repos)).sent).toHaveLength(1);
    await repos.courseComments.moderate(held.id, "approve", STAFF);
    await repos.courseComments.moderate(reported.id, "dismiss", STAFF);
    vi.setSystemTime(NOW + 2 * DAY);
    expect(await sendModerationDigest(repos)).toEqual({ sent: [], dryRun: [] });
  });

  it("only logs while the flag is off", async () => {
    world({ flagOn: false });
    await post(ASKER, "Held", null, { held: true });
    expect(await sendModerationDigest(repos)).toEqual({ sent: [], dryRun: [{ memberId: STAFF, kind: "lesson_comment_moderation" }] });
    expect(dataset.notificationLog).toEqual([]);
  });

  it("says nothing when no one is staff", async () => {
    dataset.userProfiles.length = 0;
    await post(ASKER, "Held", null, { held: true });
    expect(await sendModerationDigest(repos)).toEqual({ sent: [], dryRun: [] });
  });
});

describe("countUnread", () => {
  const comment = (id: string, memberId: string, createdAt: string, over: Record<string, unknown> = {}) => ({
    id, lessonId: LESSON, memberId, parentId: null, authorName: "x", isInstructorReply: false, createdAt, editedAt: null, removed: false, body: "b", hidden: false, held: false, ...over,
  });
  const entries = [
    { comment: comment("c1", REPLIER, "2027-03-02T10:00:00Z"), replies: [comment("c2", ASKER, "2027-03-02T11:00:00Z"), comment("c3", STAFF, "2027-03-02T12:00:00Z")] },
    { comment: comment("c4", REPLIER, "2027-03-02T13:00:00Z", { removed: true }), replies: [comment("c5", REPLIER, "2027-03-02T14:00:00Z", { held: true })] },
  ];

  it("counts live comments by others made after the last visit", () => {
    expect(countUnread(entries, ASKER, "2027-03-02T10:30:00Z")).toBe(1);
    expect(countUnread(entries, ASKER, "2027-03-02T09:00:00Z")).toBe(2);
  });

  it("never counts an imported comment, however recent its date", () => {
    const imported = [{ comment: comment("i1", "", "2027-03-02T12:00:00Z", { imported: true }), replies: [comment("i2", "", "2027-03-02T13:00:00Z", { imported: true })] }];
    expect(countUnread(imported, ASKER, "2027-03-02T09:00:00Z")).toBe(0);
  });

  it("is zero on a first visit, and never counts your own comments, removed ones or held ones", () => {
    expect(countUnread(entries, ASKER, null)).toBe(0);
    expect(countUnread(entries, REPLIER, "2027-03-02T09:00:00Z")).toBe(2);
  });
});
