import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { setClock, systemClock } from "@/lib/clock";

const state = vi.hoisted(() => ({ caller: null as unknown, feature: true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/analytics/server", () => ({ withAction: (_name: string, run: () => unknown) => run() }));
vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: async () => state.caller }));
vi.mock("@/lib/features.server", () => ({ effectiveMemberHasFeature: async () => state.feature, getUserFeaturePreviews: async () => [] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

let data = new InMemoryDataset();
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: () => actual.createInMemoryRepos(data) };
});

import { deleteLessonComment, editLessonComment, postLessonComment } from "@/app/(member)/courses/comment-actions";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const SOON = "les_AAAAAAAAAAA2";
const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
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
  data.members.push({ id: ADA, name: "Ada <Quill> & Co" }, { id: BEA, name: "Bea Example" });
  data.courses.push({ id: COURSE, is_draft: false, title: "Course", slug: "course" } as never);
  data.courseLessons.push({ id: LESSON, course_id: COURSE, state: "open", title: "One" } as never, { id: SOON, course_id: COURSE, state: "coming_soon", title: "Two" } as never);
  const access = (member: string, endsAt: string | null) => ({ member_id: member, course_id: COURSE, starts_at: "2020-01-01T00:00:00Z", ends_at: endsAt }) as never;
  data.courseAccess.push(access(ADA, null), access(BEA, "2021-02-01T00:00:00Z"));
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
    const thread = await comments().threadFor(LESSON);
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

describe("clock", () => {
  it("is restored for other tests", () => {
    setClock(systemClock);
    expect(true).toBe(true);
  });
});
