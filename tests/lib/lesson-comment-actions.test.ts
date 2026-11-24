import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { setClock, systemClock } from "@/lib/clock";

const state = vi.hoisted(() => ({ caller: null as unknown, feature: true }));
const notify = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ sent: [], dryRun: [] })));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() runs its callback when the response is done; here, at once.
vi.mock("next/server", () => ({ after: (run: () => unknown) => void run() }));
vi.mock("@/lib/courses/comment-notifications", () => ({ notifyLessonComment: (...args: unknown[]) => notify(...args) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: (_name: string, run: () => unknown) => run() }));
vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: async () => state.caller }));
vi.mock("@/lib/features.server", () => ({ effectiveMemberHasFeature: async () => state.feature, getUserFeaturePreviews: async () => [] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

let data = new InMemoryDataset();
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: () => actual.createInMemoryRepos(data) };
});

import { deleteLessonComment, editLessonComment, postLessonComment, reportLessonComment, setLessonCommentFollow, suggestCommentMentions } from "@/app/(member)/courses/comment-actions";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const SOON = "les_AAAAAAAAAAA2";
const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const CAL = "mbr_AAAAAAAAAAA3";
const NOW = Date.parse("2027-03-01T15:00:00Z");

function callerFor(memberId: string, extra: { isSudo?: boolean; isAdminActing?: boolean } = {}) {
  return { userId: "u", identity: { memberId, memberName: "x", memberEmail: "x", isSudo: extra.isSudo ?? false }, scope: { memberId, isAdminActing: extra.isAdminActing ?? false } };
}

beforeEach(() => {
  data = new InMemoryDataset();
  setClock({ now: () => NOW, sleep: async () => {} });
  state.feature = true;
  state.caller = callerFor(ADA);
  data.lessonComments.length = 0;
  data.courseAccess.length = 0;
  data.courses.length = 0;
  data.courseLessons.length = 0;
  data.members.length = 0;
  data.members.push({ id: ADA, name: "Ada <Quill> & Co" }, { id: BEA, name: "Bea Example" }, { id: CAL, name: "Cal Example" });
  data.courses.push({ id: COURSE, is_draft: false, title: "Course", slug: "course" } as never);
  data.courseLessons.push({ id: LESSON, course_id: COURSE, state: "open", title: "One" } as never, { id: SOON, course_id: COURSE, state: "coming_soon", title: "Two" } as never);
  const access = (member: string, endsAt: string | null) => ({ member_id: member, course_id: COURSE, starts_at: "2020-01-01T00:00:00Z", ends_at: endsAt }) as never;
  data.courseAccess.push(access(ADA, null), access(BEA, "2021-02-01T00:00:00Z"), access(CAL, null));
  data.lessonCommentReports.length = 0;
  data.lessonCommentFollows.length = 0;
  notify.mockClear();
});

const comments = () => createInMemoryRepos(data).courseComments;

describe("postLessonComment", () => {
  it("posts a comment as the member, keeping the text as typed", async () => {
    const result = await postLessonComment(LESSON, "  Why is the <b>hook</b> & the &amp; here?\r\nSecond line  ", null);

    expect(result.error).toBeUndefined();
    const stored = await comments().byId(result.id!);
    expect(stored).toMatchObject({ memberId: ADA, body: "Why is the <b>hook</b> & the &amp; here?\nSecond line", isStaffReply: false, parentId: null });
  });

  it("shows the author by display name with & and < as typed", async () => {
    await postLessonComment(LESSON, "Hello", null);
    const thread = await comments().threadFor(LESSON, { memberId: ADA, isStaff: false });
    expect(thread.entries[0].comment.authorName).toBe("Ada <Quill> & Co");
  });

  it("marks an admin acting as themselves as staff", async () => {
    state.caller = callerFor(ADA, { isAdminActing: true });
    const result = await postLessonComment(LESSON, "An answer", null);
    expect((await comments().byId(result.id!))?.isStaffReply).toBe(true);
  });

  it("refuses a signed-out caller, the flag being off, and sudo", async () => {
    state.caller = null;
    expect((await postLessonComment(LESSON, "Hi", null)).error).toBeTruthy();
    state.caller = callerFor(ADA);
    state.feature = false;
    expect((await postLessonComment(LESSON, "Hi", null)).error).toBeTruthy();
    state.feature = true;
    state.caller = callerFor(ADA, { isSudo: true });
    expect((await postLessonComment(LESSON, "Hi", null)).error).toBe("Read-only while previewing");
    expect(data.lessonComments).toHaveLength(0);
  });

  it("refuses a lesson the member can't open: no access, ended access, coming soon, a draft course, bad ids", async () => {
    state.caller = callerFor("mbr_AAAAAAAAAAA9");
    expect((await postLessonComment(LESSON, "Hi", null)).error).toBeTruthy();
    state.caller = callerFor(BEA);
    expect((await postLessonComment(LESSON, "Hi", null)).error).toBeTruthy();
    state.caller = callerFor(ADA);
    expect((await postLessonComment(SOON, "Hi", null)).error).toBeTruthy();
    expect((await postLessonComment("not-an-id", "Hi", null)).error).toBeTruthy();
    expect((await postLessonComment(LESSON, "Hi", "not-an-id")).error).toBeTruthy();
    data.courses[0].is_draft = true;
    expect((await postLessonComment(LESSON, "Hi", null)).error).toBeTruthy();
    expect(data.lessonComments).toHaveLength(0);
  });

  it("holds the text to 1 to 4,000 characters after trimming", async () => {
    expect((await postLessonComment(LESSON, "   \n ", null)).error).toBe("Write something first");
    expect((await postLessonComment(LESSON, "x".repeat(4001), null)).error).toMatch(/under 4,000/);
    expect((await postLessonComment(LESSON, "x".repeat(4000), null)).error).toBeUndefined();
  });

  it("attaches a reply to a reply to the top-level comment, and refuses a missing, removed or other-lesson parent", async () => {
    const top = (await postLessonComment(LESSON, "Question", null)).id!;
    const reply = (await postLessonComment(LESSON, "Reply", top)).id!;
    const nested = (await postLessonComment(LESSON, "Reply to the reply", reply)).id!;
    expect((await comments().byId(nested))?.parentId).toBe(top);

    expect((await postLessonComment(LESSON, "Hi", "cmnt_ZZZZZZZZZZZZ")).error).toBe("That comment is no longer there");
    await comments().softDelete(top, ADA, "2027-03-01T15:00:00.000Z");
    expect((await postLessonComment(LESSON, "Hi", reply)).error).toBe("That comment is no longer there");
  });

  it("limits a member to 5 comments a minute and 30 an hour", async () => {
    const hits: boolean[] = [];
    for (let i = 0; i < 6; i++) hits.push(!(await postLessonComment(LESSON, `Comment ${i}`, null)).error);
    expect(hits).toEqual([true, true, true, true, true, false]);
    expect(data.lessonComments).toHaveLength(5);
    expect((await postLessonComment(LESSON, "More", null)).error).toMatch(/posting quickly/);
  });
});

describe("following and telling people", () => {
  it("follows the lesson when you post, and tells the people a reply is for after the response", async () => {
    const question = await postLessonComment(LESSON, "Question", null);
    expect(await comments().isFollowing(ADA, LESSON)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);

    state.caller = callerFor(CAL);
    const reply = await postLessonComment(LESSON, "Reply", question.id!);
    expect(await comments().isFollowing(CAL, LESSON)).toBe(true);
    expect(notify).toHaveBeenLastCalledWith(expect.anything(), reply.id);
  });

  it("keeps a member's choice not to follow when they post again", async () => {
    await comments().setFollowing(ADA, LESSON, false);
    await postLessonComment(LESSON, "Question", null);
    expect(await comments().isFollowing(ADA, LESSON)).toBe(false);
  });

  it("follows but tells no one while a comment is held for review", async () => {
    const held = await postLessonComment(LESSON, "see https://a.example https://b.example and https://c.example", null);
    expect(held.held).toBe(true);
    expect(await comments().isFollowing(ADA, LESSON)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("still posts when the follow can't be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(Object.getPrototypeOf(comments()), "ensureFollowing").mockRejectedValueOnce(new Error("db down"));
    const result = await postLessonComment(LESSON, "Question", null);
    expect(result.error).toBeUndefined();
    expect(await comments().byId(result.id!)).not.toBeNull();
    spy.mockRestore();
  });
});

describe("setLessonCommentFollow", () => {
  it("follows and unfollows a lesson as the member", async () => {
    expect(await setLessonCommentFollow(LESSON, true)).toEqual({ id: LESSON });
    expect(await comments().isFollowing(ADA, LESSON)).toBe(true);
    expect(await setLessonCommentFollow(LESSON, false)).toEqual({ id: LESSON });
    expect(await comments().isFollowing(ADA, LESSON)).toBe(false);
  });

  it("refuses a signed-out caller, the flag being off, sudo, bad input and a lesson the member can't open", async () => {
    state.caller = null;
    expect((await setLessonCommentFollow(LESSON, true)).error).toBeTruthy();
    state.caller = callerFor(ADA);
    state.feature = false;
    expect((await setLessonCommentFollow(LESSON, true)).error).toBeTruthy();
    state.feature = true;
    state.caller = callerFor(ADA, { isSudo: true });
    expect((await setLessonCommentFollow(LESSON, true)).error).toBe("Read-only while previewing");
    state.caller = callerFor(ADA);
    expect((await setLessonCommentFollow("not-an-id", true)).error).toBeTruthy();
    expect((await setLessonCommentFollow(LESSON, "yes" as never)).error).toBeTruthy();
    expect((await setLessonCommentFollow(SOON, true)).error).toBeTruthy();
    state.caller = callerFor(BEA);
    expect((await setLessonCommentFollow(LESSON, true)).error).toBeTruthy();
    expect(data.lessonCommentFollows).toHaveLength(0);
  });

  it("says so when it can't be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Object.getPrototypeOf(comments()), "setFollowing").mockRejectedValueOnce(new Error("db down"));
    expect((await setLessonCommentFollow(LESSON, true)).error).toBe("Couldn't save that");
  });
});

describe("held comments", () => {
  const links = "see https://a.example https://b.example and https://c.example";

  it("holds a comment with more than two links, visible to its author and staff only", async () => {
    const result = await postLessonComment(LESSON, links, null);

    expect(result).toMatchObject({ held: true });
    expect((await comments().byId(result.id!))?.heldAt).not.toBeNull();
    const thread = (viewer: { memberId: string; isStaff: boolean }) => comments().threadFor(LESSON, viewer);
    expect((await thread({ memberId: CAL, isStaff: false })).entries).toEqual([]);
    expect((await thread({ memberId: ADA, isStaff: false })).entries[0].comment).toMatchObject({ held: true, body: links });
    expect((await thread({ memberId: CAL, isStaff: true })).entries[0].comment.held).toBe(true);
  });

  it("lets two links through, and never holds staff", async () => {
    expect((await postLessonComment(LESSON, "https://a.example and https://b.example", null)).held).toBeUndefined();
    state.caller = callerFor(ADA, { isAdminActing: true });
    expect((await postLessonComment(LESSON, links, null)).held).toBeUndefined();
    expect(data.lessonComments.map((c) => c.held_at)).toEqual([null, null]);
  });

  it("refuses a reply under a held comment, and an edit that adds links", async () => {
    const held = (await postLessonComment(LESSON, links, null)).id!;
    expect((await postLessonComment(LESSON, "Reply", held)).error).toBe("That comment is no longer there");

    const plain = (await postLessonComment(LESSON, "Plain", null)).id!;
    data.lessonComments[1].created_at = new Date(NOW).toISOString();
    expect((await editLessonComment(plain, links)).error).toBe("Comments can have up to 2 links");
    expect((await comments().byId(plain))?.body).toBe("Plain");
  });
});

describe("reportLessonComment", () => {
  const post = async (author = BEA) => {
    state.caller = callerFor(author);
    const id = (await postLessonComment(LESSON, "Questionable <words> & more", null)).id!;
    state.caller = callerFor(CAL);
    return id;
  };

  it("stores the reason as typed, once per reporter, and tells the author nothing", async () => {
    state.caller = callerFor(ADA);
    const id = (await postLessonComment(LESSON, "Questionable", null)).id!;
    state.caller = callerFor(CAL);

    expect(await reportLessonComment(id, "  It's spam & <rude>  ")).toEqual({ id });

    expect(data.lessonCommentReports).toMatchObject([{ comment_id: id, reporter_id: CAL, reason: "It's spam & <rude>", resolved_at: null }]);
    expect((await reportLessonComment(id, "Again")).error).toBe("You've already reported this comment");
    expect(data.lessonCommentReports).toHaveLength(1);
    // Nothing changes for the author: the comment is as it was and no notification is made.
    expect((await comments().byId(id))?.hiddenAt).toBeNull();
    expect(data.inAppNotifications).toHaveLength(0);
  });

  it("refuses your own comment, and staff (who hide it directly)", async () => {
    state.caller = callerFor(ADA);
    const id = (await postLessonComment(LESSON, "Mine", null)).id!;
    expect((await reportLessonComment(id, "Me")).error).toBe("You can't report your own comment");
    state.caller = callerFor(CAL, { isAdminActing: true });
    expect((await reportLessonComment(id, "Staff")).error).toMatch(/moderation queue/);
    expect(data.lessonCommentReports).toHaveLength(0);
  });

  it("refuses a signed-out caller, the flag being off, sudo, bad ids, and a lesson the reporter can't open", async () => {
    const id = await post(ADA);
    state.caller = null;
    expect((await reportLessonComment(id, "x")).error).toBeTruthy();
    state.caller = callerFor(CAL);
    state.feature = false;
    expect((await reportLessonComment(id, "x")).error).toBeTruthy();
    state.feature = true;
    state.caller = callerFor(CAL, { isSudo: true });
    expect((await reportLessonComment(id, "x")).error).toBe("Read-only while previewing");
    state.caller = callerFor(CAL);
    expect((await reportLessonComment("nope", "x")).error).toBeTruthy();
    expect((await reportLessonComment("cmnt_ZZZZZZZZZZZZ", "x")).error).toBeTruthy();
    state.caller = callerFor(BEA);
    expect((await reportLessonComment(id, "x")).error).toBeTruthy();
    expect(data.lessonCommentReports).toHaveLength(0);
  });

  it("looks the same for a comment that is deleted, hidden or held", async () => {
    const deleted = await post(ADA);
    const hidden = await post(ADA);
    await comments().softDelete(deleted, ADA, "2027-03-01T15:00:00.000Z");
    await comments().moderate(hidden, "hide", null);
    state.caller = callerFor(ADA);
    const held = (await postLessonComment(LESSON, "a https://a.example https://b.example https://c.example", null)).id!;
    state.caller = callerFor(CAL);

    for (const id of [deleted, hidden, held]) expect((await reportLessonComment(id, "x")).error).toBe("Comments aren't available on this lesson");
    expect(data.lessonCommentReports).toHaveLength(0);
  });

  it("holds the reason to 1 to 500 characters", async () => {
    const id = await post(ADA);
    expect((await reportLessonComment(id, "   ")).error).toBe("Tell us briefly what's wrong");
    expect((await reportLessonComment(id, "x".repeat(501))).error).toMatch(/under 500/);
    expect((await reportLessonComment(id, "x".repeat(500))).error).toBeUndefined();
  });

  it("limits a reporter to 10 an hour", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      ids.push((await comments().create({ lessonId: LESSON, memberId: ADA, parentId: null, body: `Comment ${i}`, isStaffReply: false })).id);
    }
    state.caller = callerFor(CAL);
    const outcomes = [];
    for (const id of ids) outcomes.push(!(await reportLessonComment(id, "x")).error);
    expect(outcomes.filter(Boolean)).toHaveLength(10);
    expect((await reportLessonComment(ids[10], "x")).error).toMatch(/lot of reports/);
  });
});

describe("editLessonComment", () => {
  it("edits your own comment inside 15 minutes, and not after", async () => {
    const id = (await postLessonComment(LESSON, "Before", null)).id!;
    data.lessonComments[0].created_at = new Date(NOW - 14 * 60_000).toISOString();
    expect((await editLessonComment(id, "After")).error).toBeUndefined();
    expect((await comments().byId(id))?.body).toBe("After");
    expect((await comments().byId(id))?.editedAt).toBe(new Date(NOW).toISOString());

    data.lessonComments[0].created_at = new Date(NOW - 16 * 60_000).toISOString();
    expect((await editLessonComment(id, "Too late")).error).toMatch(/15 minutes/);
    expect((await comments().byId(id))?.body).toBe("After");
  });

  it("never edits someone else's, a deleted one, in sudo, or with bad text", async () => {
    const id = (await postLessonComment(LESSON, "Mine", null)).id!;
    data.lessonComments[0].created_at = new Date(NOW).toISOString();
    state.caller = callerFor(BEA);
    expect((await editLessonComment(id, "Not yours")).error).toBeTruthy();
    state.caller = callerFor(ADA, { isSudo: true });
    expect((await editLessonComment(id, "Previewing")).error).toBe("Read-only while previewing");
    state.caller = callerFor(ADA);
    expect((await editLessonComment(id, "  ")).error).toBe("Write something first");
    expect((await editLessonComment("nope", "x")).error).toBeTruthy();
    await comments().softDelete(id, ADA, "2027-03-01T15:00:00.000Z");
    expect((await editLessonComment(id, "Zombie")).error).toBeTruthy();
    expect((await comments().byId(id))?.body).toBe("Mine");
  });
});

describe("deleteLessonComment", () => {
  it("soft deletes your own comment at any age and records who", async () => {
    const id = (await postLessonComment(LESSON, "Mine", null)).id!;
    data.lessonComments[0].created_at = "2027-01-01T00:00:00.000Z";

    expect((await deleteLessonComment(id)).error).toBeUndefined();

    const stored = await comments().byId(id);
    expect(stored?.deletedAt).toBe(new Date(NOW).toISOString());
    expect(data.lessonComments[0].deleted_by).toBe(ADA);
  });

  it("refuses someone else's comment, sudo, and a signed-out caller", async () => {
    const id = (await postLessonComment(LESSON, "Mine", null)).id!;
    state.caller = callerFor(BEA);
    expect((await deleteLessonComment(id)).error).toBeTruthy();
    state.caller = callerFor(ADA, { isSudo: true });
    expect((await deleteLessonComment(id)).error).toBe("Read-only while previewing");
    state.caller = null;
    expect((await deleteLessonComment(id)).error).toBeTruthy();
    expect((await comments().byId(id))?.deletedAt).toBeNull();
  });
});

describe("imported comments", () => {
  const importedBy = async (memberId: string) =>
    (await comments().upsertImported("kajabi", [{ lessonId: LESSON, sourceKey: "k/1", parentId: null, memberId, isStaffReply: false, body: "From Kajabi", createdAt: new Date(NOW - 60 * 60_000).toISOString(), deletedAt: null }]))[0].id;

  it("can't be edited or deleted by another member, but can be replied to and reported", async () => {
    const id = await importedBy(CAL);

    expect((await editLessonComment(id, "Mine now")).error).toBeTruthy();
    expect((await deleteLessonComment(id)).error).toBeTruthy();
    expect(await comments().byId(id)).toMatchObject({ body: "From Kajabi", deletedAt: null });

    const reply = await postLessonComment(LESSON, "A reply from a member", id);
    expect(reply.error).toBeUndefined();
    expect((await comments().byId(reply.id!))?.parentId).toBe(id);

    expect((await reportLessonComment(id, "Not for this course")).error).toBeUndefined();
    expect(data.lessonCommentReports).toHaveLength(1);
  });

  it("belongs to its author: they can delete it, but the 15 minutes to edit it long ago ended", async () => {
    const id = await importedBy(ADA);

    expect((await editLessonComment(id, "Changed")).error).toMatch(/15 minutes/);
    expect((await deleteLessonComment(id)).error).toBeUndefined();
    expect((await comments().byId(id))?.deletedAt).not.toBeNull();
  });
});

describe("clock", () => {
  it("is restored for other tests", () => {
    setClock(systemClock);
    expect(true).toBe(true);
  });
});

describe("mentions", () => {
  const token = (id: string) => `@[${id}]`;

  it("posts a comment that mentions a member of the course, and hands it to the notifier", async () => {
    const result = await postLessonComment(LESSON, `Hi ${token(CAL)}`, null);

    expect(result.error).toBeUndefined();
    expect((await comments().byId(result.id!))?.body).toBe(`Hi ${token(CAL)}`);
    expect(notify).toHaveBeenCalledWith(expect.anything(), result.id);
  });

  it("refuses someone who can't open the course (access ended, or not a member), and more than five people", async () => {
    expect((await postLessonComment(LESSON, `Hi ${token(BEA)}`, null)).error).toBe("You can only mention people who are in this course");
    expect((await postLessonComment(LESSON, `Hi ${token("mbr_ZZZZZZZZZZZZ")}`, null)).error).toBe("You can only mention people who are in this course");
    const many = ["mbr_AAAAAAAAAAA3", "mbr_AAAAAAAAAAA4", "mbr_AAAAAAAAAAA5", "mbr_AAAAAAAAAAA6", "mbr_AAAAAAAAAAA7", "mbr_AAAAAAAAAAA8"].map(token).join(" ");
    expect((await postLessonComment(LESSON, many, null)).error).toBe("Mention up to 5 people in one comment");
    expect(data.lessonComments).toHaveLength(0);
  });

  it("checks the mentions of an edit too, and tells the people it adds", async () => {
    const id = (await postLessonComment(LESSON, "Before", null)).id!;
    data.lessonComments[0].created_at = new Date(NOW).toISOString();
    notify.mockClear();

    expect((await editLessonComment(id, `Now ${token(BEA)}`)).error).toBe("You can only mention people who are in this course");
    expect(notify).not.toHaveBeenCalled();
    expect((await editLessonComment(id, `Now ${token(CAL)}`)).error).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(expect.anything(), id, expect.any(Date), "mentions");
  });
});

describe("suggestCommentMentions", () => {
  it("offers members of the course who match, never the writer or someone whose access ended", async () => {
    data.members.push({ id: "mbr_AAAAAAAAAAA4", name: "Cala Other" });
    data.courseAccess.push({ member_id: "mbr_AAAAAAAAAAA4", course_id: COURSE, starts_at: "2020-01-01T00:00:00Z", ends_at: null } as never);

    const found = await suggestCommentMentions(LESSON, "cal");
    expect(found.map((c) => c.name).sort()).toEqual(["Cal Example", "Cala Other"]);
    expect(found.every((c) => c.isInstructor === false)).toBe(true);
    expect(await suggestCommentMentions(LESSON, "bea")).toEqual([]);
    expect(await suggestCommentMentions(LESSON, "ada")).toEqual([]);
  });

  it("offers nothing for an empty query, a bad lesson, the flag off, sudo, no caller or a lesson that is not open", async () => {
    expect(await suggestCommentMentions(LESSON, "  ")).toEqual([]);
    expect(await suggestCommentMentions("nope", "cal")).toEqual([]);
    expect(await suggestCommentMentions(SOON, "cal")).toEqual([]);
    state.feature = false;
    expect(await suggestCommentMentions(LESSON, "cal")).toEqual([]);
    state.feature = true;
    state.caller = callerFor(ADA, { isSudo: true });
    expect(await suggestCommentMentions(LESSON, "cal")).toEqual([]);
    state.caller = null;
    expect(await suggestCommentMentions(LESSON, "cal")).toEqual([]);
  });
});
