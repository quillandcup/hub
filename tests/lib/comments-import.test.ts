import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { authorNameKey, CommentsImportError, importKajabiLessonComments, plainCommentText } from "@/lib/courses/comments-import";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const K_COURSE = "kc-1";
const L1 = "les_AAAAAAAAAAA1";
const L2 = "les_AAAAAAAAAAA2";
const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const SAM = "mbr_AAAAAAAAAAA3";
const CY1 = "mbr_AAAAAAAAAAA4";
const CY2 = "mbr_AAAAAAAAAAA5";

type Bronze = InMemoryDataset["kajabiLessonComments"][number];

const bronze = (lesson: string, key: string, over: Partial<Bronze> = {}): Bronze => ({
  course_kajabi_id: K_COURSE,
  lesson_kajabi_id: lesson,
  comment_key: key,
  parent_comment_key: null,
  author_name: "Ada Example",
  posted_at: "2025-02-03T10:00:00Z",
  body: `Comment ${key}`,
  captured_at: "2026-11-01T10:00:00Z",
  deleted_at: null,
  ...over,
});

const contact = (id: string, name: string, email: string) => ({ kajabi_contact_id: id, name, email, data: {}, imported_at: "2026-01-01T00:00:00Z" }) as never;

const world = (comments: Bronze[], instructors: string[] = []) => {
  const data = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example", email: "ada@example.test", userId: "u-ada" },
      { id: BEA, name: "Bea Example", email: "bea@example.test", userId: "u-bea" },
      { id: SAM, name: "Sam Staff", email: "sam@example.test", userId: "u-sam" },
      { id: CY1, name: "Cy Twin", email: "cy1@example.test", userId: "u-cy1" },
      { id: CY2, name: "Cy Twin", email: "cy2@example.test", userId: "u-cy2" },
    ],
    userProfiles: [{ id: "u-sam", email: "sam@example.test", role: "admin" }],
    emailAliases: [{ id: "mea_AAAAAAAAAAA1", memberId: ADA, active: true, alias_email: "ada.old@example.test", canonical_email: "ada@example.test" }],
    kajabiContacts: [
      contact("k1", "Ada Example", "ada@example.test"),
      contact("k2", "Ada Example", "ADA.OLD@example.test"),
      contact("k3", "Bea Example", "bea@example.test"),
      contact("k4", "Sam Staff", "sam@example.test"),
      contact("k5", "Cy Twin", "cy1@example.test"),
      contact("k6", "Cy Twin", "cy2@example.test"),
      contact("k7", "Ghost Contact", "ghost@example.test"),
      contact("k8", "Zoë Example", "bea@example.test"),
    ],
    courses: [courseRow({ id: COURSE, slug: "demo", title: "Demo", source: "kajabi", source_key: K_COURSE, is_draft: false })],
    courseLessons: [
      lessonRow({ id: L1, course_id: COURSE, title: "One", source: "kajabi", source_key: "kl-1" }),
      lessonRow({ id: L2, course_id: COURSE, title: "Two", source: "kajabi", source_key: "kl-2" }),
    ],
    kajabiLessonComments: comments,
    courseInstructors: instructors.map((memberId, i) => ({ id: `cinst_AAAAAAAAAAA${i + 1}`, course_id: COURSE, member_id: memberId, created_at: "2026-01-01T00:00:00Z" })),
  });
  return { data, repos: createInMemoryRepos(data) };
};

const stored = (data: InMemoryDataset) => data.lessonComments.filter((c) => c.source === "kajabi");
const course = async (w: ReturnType<typeof world>, dryRun = false) => (await importKajabiLessonComments(w.repos, { courseSlug: "demo", dryRun })).courses[0];

describe("plainCommentText", () => {
  it("leaves plain text as it is, apart from line endings and the ends", () => {
    expect(plainCommentText("  Hello\r\nthere  \n\n\n\nBye  ")).toBe("Hello\nthere\n\nBye");
    expect(plainCommentText("a < b and c > d, 5 & 6")).toBe("a < b and c > d, 5 & 6");
  });

  it("reduces HTML to the plain text the Hub stores", () => {
    expect(plainCommentText("<p>Hi <strong>there</strong></p><p>Second&nbsp;line<br/>third &amp; last</p>")).toBe("Hi there\nSecond line\nthird & last");
    expect(plainCommentText('<a href="https://example.com/x?a=1&amp;b=2" onclick="evil()">link text</a> &lt;kept&gt; &#39;q&#39; &#x41;')).toBe("link text <kept> 'q' A");
    expect(plainCommentText("before<script>alert(1)</script>after<style>p{}</style>")).toBe("beforeafter");
    expect(plainCommentText("&unknown; &#xZZ;")).toBe("&unknown; &#xZZ;");
  });
});

describe("authorNameKey", () => {
  it("compares names exactly apart from case, spacing and markup, and gives no key to an empty name or an email", () => {
    expect(authorNameKey("  Ada   EXAMPLE ")).toBe("ada example");
    expect(authorNameKey("<b>Ada</b> Example")).toBe("ada example");
    expect(authorNameKey("Zoë Example")).toBe(authorNameKey("Zoë Example"));
    expect(authorNameKey("Zoe Example")).not.toBe(authorNameKey("Zoë Example"));
    expect(authorNameKey("Ada Example.")).not.toBe(authorNameKey("Ada Example"));
    expect(authorNameKey("")).toBe("");
    expect(authorNameKey(null)).toBe("");
    expect(authorNameKey("ada@example.test")).toBe("");
  });
});

describe("importKajabiLessonComments", () => {
  it("imports a thread as the members who wrote it, with Kajabi's times, and gives the badge to the course's instructors, not to staff who are not one", async () => {
    const w = world([
      bronze("kl-1", "c1", { posted_at: "2025-01-01T09:00:00Z" }),
      bronze("kl-1", "c2", { parent_comment_key: "c1", posted_at: "2025-01-02T09:00:00Z", author_name: "  bea  EXAMPLE " }),
      bronze("kl-1", "c3", { parent_comment_key: "c1", author_name: "Sam Staff" }),
      bronze("kl-2", "c4", { author_name: "Zoë Example" }),
    ], [BEA]);

    const summary = await course(w);

    expect(summary).toMatchObject({ commentsInBronze: 4, inserted: 4, updated: 0, unchanged: 0, replies: 2, orphanReplies: 0, unmatchedLessonComments: 0, instructors: 1 });
    // Bea teaches the course (two names Kajabi shows are hers); Sam is staff but not an instructor of it.
    expect(summary.authors).toEqual({ matched: 4, instructors: 2, unmatched: 0, ambiguous: 0 });
    const byKey = new Map(stored(w.data).map((r) => [r.source_key, r]));
    const top = byKey.get("kl-1/c1")!;
    expect(top).toMatchObject({ lesson_id: L1, member_id: ADA, parent_id: null, body: "Comment c1", is_staff_reply: false, held_at: null, hidden_at: null, deleted_at: null });
    expect(new Date(top.created_at).toISOString()).toBe("2025-01-01T09:00:00.000Z");
    expect(byKey.get("kl-1/c2")).toMatchObject({ parent_id: top.id, member_id: BEA, is_staff_reply: true });
    expect(byKey.get("kl-1/c3")).toMatchObject({ parent_id: top.id, member_id: SAM, is_staff_reply: false });
    // A contact with an accent in the name is matched by that exact name.
    expect(byKey.get("kl-2/c4")).toMatchObject({ member_id: BEA, is_staff_reply: true });
    const thread = await w.repos.courseComments.threadFor(L1, { memberId: ADA, isStaff: false });
    expect(thread.entries[0].comment).toMatchObject({ authorName: "Ada Example", imported: true, memberId: ADA });
    expect(thread.entries[0].replies.map((r) => [r.authorName, r.isInstructorReply])).toEqual([["Bea Example", true], ["Sam Staff", false]]);
  });

  it("says plainly when the course has no instructors: no badge for anyone, staff included, until one is added and the import runs again", async () => {
    const w = world([bronze("kl-1", "c1"), bronze("kl-1", "c2", { parent_comment_key: "c1", author_name: "Sam Staff" })]);

    const dry = await course(w, true);
    expect(dry.instructors).toBe(0);
    expect(dry.authors.instructors).toBe(0);
    expect(stored(w.data)).toEqual([]);

    await course(w);
    expect(stored(w.data).map((r) => r.is_staff_reply)).toEqual([false, false]);

    // Staff add Sam to the course's instructors; the next import brings the badge onto the comments already there.
    w.data.courseInstructors.push({ id: "cinst_AAAAAAAAAAA1", course_id: COURSE, member_id: SAM, created_at: "2026-01-01T00:00:00Z" });
    const again = await course(w);
    expect(again).toMatchObject({ instructors: 1, inserted: 0, updated: 1, unchanged: 1 });
    expect(stored(w.data).find((r) => r.member_id === SAM)?.is_staff_reply).toBe(true);
  });

  it("treats two contacts of one member (an address and its alias) as one person", async () => {
    const w = world([bronze("kl-1", "c1", { author_name: "ada example" })]);

    const summary = await course(w);

    expect(summary.authors).toEqual({ matched: 1, instructors: 0, unmatched: 0, ambiguous: 0 });
    expect(stored(w.data)[0].member_id).toBe(ADA);
  });

  it("matches by the exact Kajabi contact name, never fuzzy, and lists the names it could not settle instead of guessing", async () => {
    const w = world([
      bronze("kl-1", "ok", { author_name: "Ada Example" }),
      bronze("kl-1", "near", { author_name: "Ada Exampl" }),
      bronze("kl-1", "dots", { author_name: "Ada Example." }),
      bronze("kl-1", "nick", { author_name: "Adie" }),
      bronze("kl-1", "nick2", { author_name: "Adie" }),
      bronze("kl-1", "ghost", { author_name: "Ghost Contact" }),
      bronze("kl-1", "twin", { author_name: "Cy Twin" }),
      bronze("kl-1", "mail", { author_name: "ada@example.test" }),
      bronze("kl-1", "blank", { author_name: "  " }),
      bronze("kl-1", "reply", { parent_comment_key: "nick", author_name: "Bea Example" }),
    ]);

    const summary = await course(w);

    expect(stored(w.data).map((r) => r.source_key).sort()).toEqual(["kl-1/ok", "kl-1/reply"]);
    expect(summary).toMatchObject({ inserted: 2, unmatchedAuthorComments: 7, ambiguousAuthorComments: 1, orphanReplies: 1 });
    expect(summary.authors).toEqual({ matched: 2, instructors: 0, unmatched: 6, ambiguous: 1 });
    expect(summary.ambiguousAuthors).toEqual([{ name: "Cy Twin", comments: 1, members: 2 }]);
    expect(summary.unmatchedAuthors[0]).toEqual({ name: "Adie", comments: 2 });
    expect(summary.unmatchedAuthors.map((a) => a.name).sort()).toEqual(["(an email address)", "(no name)", "Ada Exampl", "Ada Example.", "Adie", "Ghost Contact"]);
    expect(JSON.stringify(summary)).not.toContain("ada@example.test");
    // The reply's comment was not imported, so it stands as a top-level comment and is counted.
    expect(stored(w.data).find((r) => r.source_key === "kl-1/reply")!.parent_id).toBeNull();
  });

  it("writes nothing in a dry run, and reports the same names", async () => {
    const w = world([bronze("kl-1", "ok"), bronze("kl-1", "lost", { author_name: "Nobody Known" })]);

    const dry = await course(w, true);

    expect(stored(w.data)).toHaveLength(0);
    expect(dry).toMatchObject({ inserted: 1, unmatchedAuthorComments: 1 });
    expect(dry.unmatchedAuthors).toEqual([{ name: "Nobody Known", comments: 1 }]);
    expect(await course(w)).toMatchObject({ inserted: 1, unmatchedAuthorComments: 1 });
  });

  it("creates no follow, notification, report, hold or unanswered question", async () => {
    const w = world([bronze("kl-1", "c1", { posted_at: new Date().toISOString() })]);

    await course(w);

    expect(w.data.lessonCommentFollows).toEqual([]);
    expect(w.data.lessonCommentReports).toEqual([]);
    expect(w.data.notificationLog).toEqual([]);
    expect(w.data.inAppNotifications).toEqual([]);
    expect(await w.repos.courseComments.heldComments(COURSE)).toEqual([]);
    expect(await w.repos.courseComments.unansweredQuestions(COURSE)).toEqual([]);
    expect(await w.repos.courseComments.activityBetween("2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z")).toEqual([]);
  });

  it("changes nothing when run again", async () => {
    const w = world([bronze("kl-1", "c1"), bronze("kl-1", "c2", { parent_comment_key: "c1" })]);

    await course(w);
    const before = JSON.stringify(stored(w.data));
    const again = await course(w);

    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(JSON.stringify(stored(w.data))).toBe(before);
    expect(await course(w, true)).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
  });

  it("brings an edited comment up to date and leaves what staff did to it", async () => {
    const w = world([bronze("kl-1", "c1")]);
    await course(w);
    const row = stored(w.data)[0];
    row.hidden_at = "2026-11-02T00:00:00Z";
    row.handled_at = "2026-11-03T00:00:00Z";
    w.data.kajabiLessonComments[0].body = "<p>Edited text</p>";
    w.data.kajabiLessonComments[0].author_name = "Bea Example";

    const summary = await course(w);

    expect(summary).toMatchObject({ inserted: 0, updated: 1 });
    expect(stored(w.data)).toHaveLength(1);
    expect(stored(w.data)[0]).toMatchObject({ id: row.id, body: "Edited text", member_id: BEA, hidden_at: "2026-11-02T00:00:00Z", handled_at: "2026-11-03T00:00:00Z" });
  });

  it("puts a reply to a reply under the comment above it, and a reply with no comment at the top", async () => {
    const w = world([
      bronze("kl-1", "c1"),
      bronze("kl-1", "c2", { parent_comment_key: "c1" }),
      bronze("kl-1", "c3", { parent_comment_key: "c2" }),
      bronze("kl-1", "c4", { parent_comment_key: "missing" }),
      bronze("kl-1", "c5", { parent_comment_key: "c5" }),
      bronze("kl-1", "c6", { parent_comment_key: "c7" }),
      bronze("kl-1", "c7", { parent_comment_key: "c6" }),
    ]);

    const summary = await course(w);

    const byKey = new Map(stored(w.data).map((r) => [r.source_key, r]));
    const idOf = (key: string) => byKey.get(`kl-1/${key}`)!.id;
    expect(byKey.get("kl-1/c2")!.parent_id).toBe(idOf("c1"));
    expect(byKey.get("kl-1/c3")!.parent_id).toBe(idOf("c1"));
    expect(byKey.get("kl-1/c4")!.parent_id).toBeNull();
    expect(byKey.get("kl-1/c5")!.parent_id).toBeNull();
    // A loop of replies never ends in a crash: one of them lands as a top-level comment.
    expect(byKey.get("kl-1/c6")!.parent_id === null || byKey.get("kl-1/c7")!.parent_id === null).toBe(true);
    expect(summary.replies).toBe(6);
    expect(summary.orphanReplies).toBeGreaterThanOrEqual(2);
    expect(await course(w)).toMatchObject({ inserted: 0, updated: 0 });
  });

  it("counts comments on lessons the Hub does not have, and does not import them", async () => {
    const w = world([bronze("kl-1", "c1"), bronze("kl-gone", "c2"), bronze("kl-gone", "c3")]);

    const summary = await course(w);

    expect(summary).toMatchObject({ commentsInBronze: 3, unmatchedLessonComments: 2, inserted: 1 });
    expect(stored(w.data).map((r) => r.lesson_id)).toEqual([L1]);
  });

  it("skips empty and already-removed comments, and shortens very long ones", async () => {
    const w = world([
      bronze("kl-1", "empty", { body: "<p> </p>" }),
      bronze("kl-1", "removed", { deleted_at: "2026-10-01T00:00:00Z" }),
      bronze("kl-1", "long", { body: "x".repeat(4500) }),
    ]);

    const summary = await course(w);

    expect(summary).toMatchObject({ skipped: 2, truncated: 1, inserted: 1 });
    expect(stored(w.data)[0].body).toHaveLength(4000);
  });

  it("removes what Kajabi removed, brings it back when listed again, and never undoes a person's delete", async () => {
    const w = world([bronze("kl-1", "c1"), bronze("kl-1", "c2"), bronze("kl-1", "c3")]);
    await course(w);
    const ids = new Map(stored(w.data).map((r) => [r.source_key, r.id]));

    // Kajabi drops c1; staff in the Hub delete c3 and Kajabi still lists it.
    w.data.kajabiLessonComments.find((c) => c.comment_key === "c1")!.deleted_at = "2026-11-10T00:00:00Z";
    await w.repos.courseComments.moderate(ids.get("kl-1/c3")!, "delete", SAM);
    const removing = await course(w);

    expect(removing).toMatchObject({ updated: 1, removed: 1, restored: 0, unchanged: 2 });
    const c1 = stored(w.data).find((r) => r.source_key === "kl-1/c1")!;
    expect(new Date(c1.deleted_at!).toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(c1.deleted_by).toBeNull();
    expect(stored(w.data).find((r) => r.source_key === "kl-1/c3")).toMatchObject({ deleted_by: SAM });
    expect((await w.repos.courseComments.threadFor(L1, { memberId: ADA, isStaff: false })).count).toBe(1);

    // Kajabi lists c1 again: it comes back; c3 stays deleted.
    w.data.kajabiLessonComments.find((c) => c.comment_key === "c1")!.deleted_at = null;
    const restoring = await course(w);

    expect(restoring).toMatchObject({ updated: 1, restored: 1 });
    expect(stored(w.data).find((r) => r.source_key === "kl-1/c1")!.deleted_at).toBeNull();
    expect(stored(w.data).find((r) => r.source_key === "kl-1/c3")!.deleted_at).not.toBeNull();
    expect(await course(w)).toMatchObject({ updated: 0, inserted: 0 });
  });

  it("imports comments past 1,000 and does not duplicate them on a second run", async () => {
    const w = world(Array.from({ length: 1100 }, (_, i) => bronze("kl-1", `m${i}`)));

    expect(await course(w)).toMatchObject({ commentsInBronze: 1100, inserted: 1100 });
    expect(await course(w)).toMatchObject({ inserted: 0, unchanged: 1100 });
    expect(stored(w.data)).toHaveLength(1100);
  });

  it("leaves comments written in the Hub alone", async () => {
    const w = world([bronze("kl-1", "c1")]);
    await w.repos.courseComments.create({ lessonId: L1, memberId: ADA, parentId: null, body: "Mine", isInstructorReply: false });
    await course(w);

    expect(w.data.lessonComments.filter((c) => !c.source)).toHaveLength(1);
    expect(w.data.lessonComments).toHaveLength(2);
  });

  it("does nothing for a course with no Bronze comments or no source key, and rejects an unknown slug", async () => {
    const empty = world([]);
    expect(await course(empty)).toMatchObject({ commentsInBronze: 0, inserted: 0 });

    const noKey = new InMemoryDataset({ courses: [courseRow({ id: COURSE, slug: "demo", title: "Demo", source: "kajabi", source_key: null })] });
    const result = await importKajabiLessonComments(createInMemoryRepos(noKey), {});
    expect(result.courses[0]).toMatchObject({ slug: "demo", commentsInBronze: 0 });

    await expect(importKajabiLessonComments(empty.repos, { courseSlug: "nope" })).rejects.toThrow(CommentsImportError);
    await expect(importKajabiLessonComments(empty.repos, { courseSlug: "nope" })).rejects.toMatchObject({ status: 404 });
    // With no slug, every Kajabi course is looked at.
    expect((await importKajabiLessonComments(world([bronze("kl-1", "c1")]).repos)).courses).toHaveLength(1);
  });
});
