import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { cleanImportedAuthor, CommentsImportError, importKajabiLessonComments, plainCommentText } from "@/lib/courses/comments-import";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const K_COURSE = "kc-1";
const L1 = "les_AAAAAAAAAAA1";
const L2 = "les_AAAAAAAAAAA2";
const MEMBER = "mbr_AAAAAAAAAAA1";

type Bronze = InMemoryDataset["kajabiLessonComments"][number];

const bronze = (lesson: string, key: string, over: Partial<Bronze> = {}): Bronze => ({
  course_kajabi_id: K_COURSE,
  lesson_kajabi_id: lesson,
  comment_key: key,
  parent_comment_key: null,
  author_name: `Ada Example ${key}`,
  posted_at: "2025-02-03T10:00:00Z",
  body: `Comment ${key}`,
  captured_at: "2026-11-01T10:00:00Z",
  deleted_at: null,
  ...over,
});

const world = (comments: Bronze[], extra: Partial<ConstructorParameters<typeof InMemoryDataset>[0]> = {}) => {
  const data = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "demo", title: "Demo", source: "kajabi", source_key: K_COURSE, is_draft: false })],
    courseLessons: [lessonRow({ id: L1, course_id: COURSE, title: "One", source: "kajabi", source_key: "kl-1" }), lessonRow({ id: L2, course_id: COURSE, title: "Two", source: "kajabi", source_key: "kl-2" })],
    kajabiLessonComments: comments,
    ...extra,
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
    expect(plainCommentText("&unknown; &#0; &#xZZ;")).toBe("&unknown; &#0; &#xZZ;");
  });
});

describe("cleanImportedAuthor", () => {
  it("keeps a plain name on one line, drops markup, and never shows an email", () => {
    expect(cleanImportedAuthor("  Ada   Example ")).toBe("Ada Example");
    expect(cleanImportedAuthor("<b>Ada</b> &amp; Bo")).toBe("Ada & Bo");
    expect(cleanImportedAuthor("ada@example.com")).toBe("Former member");
    expect(cleanImportedAuthor("Ada ada@example.com")).toBe("Former member");
    expect(cleanImportedAuthor("")).toBe("Former member");
    expect(cleanImportedAuthor(null)).toBe("Former member");
    expect(cleanImportedAuthor("x".repeat(300))).toHaveLength(200);
  });
});

describe("importKajabiLessonComments", () => {
  it("imports a thread with the original times, the author's name and no member", async () => {
    const w = world([
      bronze("kl-1", "c1", { posted_at: "2025-01-01T09:00:00Z" }),
      bronze("kl-1", "c2", { parent_comment_key: "c1", posted_at: "2025-01-02T09:00:00Z", author_name: "Bo Example" }),
      bronze("kl-2", "c3"),
    ]);

    const summary = await course(w);

    expect(summary).toMatchObject({ commentsInBronze: 3, inserted: 3, updated: 0, unchanged: 0, replies: 1, orphanReplies: 0, unmatchedLessonComments: 0, authorsWithoutMember: 3 });
    const rows = stored(w.data);
    expect(rows).toHaveLength(3);
    const top = rows.find((r) => r.source_key === "kl-1/c1")!;
    const reply = rows.find((r) => r.source_key === "kl-1/c2")!;
    expect(top).toMatchObject({ lesson_id: L1, member_id: null, parent_id: null, author_name: "Ada Example c1", body: "Comment c1", is_staff_reply: false, held_at: null, hidden_at: null, deleted_at: null });
    expect(new Date(top.created_at).toISOString()).toBe("2025-01-01T09:00:00.000Z");
    expect(reply).toMatchObject({ parent_id: top.id, author_name: "Bo Example", is_staff_reply: false });
    // It reads as a thread: the author by name, and the reply under its comment.
    const thread = await w.repos.courseComments.threadFor(L1, { memberId: MEMBER, isStaff: false });
    expect(thread.count).toBe(2);
    expect(thread.entries[0].comment).toMatchObject({ authorName: "Ada Example c1", imported: true });
    expect(thread.entries[0].replies[0]).toMatchObject({ authorName: "Bo Example" });
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

  it("changes nothing when run again, and a dry run counts without writing", async () => {
    const w = world([bronze("kl-1", "c1"), bronze("kl-1", "c2", { parent_comment_key: "c1" })]);

    expect(await course(w, true)).toMatchObject({ inserted: 2 });
    expect(stored(w.data)).toHaveLength(0);

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
    w.data.kajabiLessonComments[0].author_name = "Ada Renamed";

    const summary = await course(w);

    expect(summary).toMatchObject({ inserted: 0, updated: 1 });
    expect(stored(w.data)).toHaveLength(1);
    expect(stored(w.data)[0]).toMatchObject({ id: row.id, body: "Edited text", author_name: "Ada Renamed", hidden_at: "2026-11-02T00:00:00Z", handled_at: "2026-11-03T00:00:00Z" });
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
    // A loop of replies never ends in a crash: they land as top-level comments.
    expect(byKey.get("kl-1/c6")!.parent_id === null || byKey.get("kl-1/c7")!.parent_id === null).toBe(true);
    expect(summary.replies).toBe(6);
    expect(summary.orphanReplies).toBeGreaterThanOrEqual(2);
    // Running it again is a no-op even for those.
    expect(await course(w)).toMatchObject({ inserted: 0, updated: 0 });
  });

  it("counts comments on lessons the Hub does not have, and does not import them", async () => {
    const w = world([bronze("kl-1", "c1"), bronze("kl-gone", "c2"), bronze("kl-gone", "c3")]);

    const summary = await course(w);

    expect(summary).toMatchObject({ commentsInBronze: 3, unmatchedLessonComments: 2, inserted: 1 });
    expect(stored(w.data).map((r) => r.lesson_id)).toEqual([L1]);
  });

  it("skips empty and already-removed comments, shortens very long ones, and never keeps an email as a name", async () => {
    const w = world([
      bronze("kl-1", "empty", { body: "<p> </p>" }),
      bronze("kl-1", "removed", { deleted_at: "2026-10-01T00:00:00Z" }),
      bronze("kl-1", "long", { body: "x".repeat(4500) }),
      bronze("kl-1", "mail", { author_name: "ada@example.com" }),
    ]);

    const summary = await course(w);

    expect(summary).toMatchObject({ skipped: 2, truncated: 1, inserted: 2 });
    const rows = stored(w.data);
    expect(rows.find((r) => r.source_key === "kl-1/long")!.body).toHaveLength(4000);
    expect(rows.find((r) => r.source_key === "kl-1/mail")!.author_name).toBe("Former member");
  });

  it("removes what Kajabi removed, brings it back when listed again, and never undoes a person's delete", async () => {
    const w = world([bronze("kl-1", "c1"), bronze("kl-1", "c2"), bronze("kl-1", "c3")]);
    await course(w);
    const ids = new Map(stored(w.data).map((r) => [r.source_key, r.id]));

    // Kajabi drops c1; staff in the Hub delete c3 and Kajabi still lists it.
    w.data.kajabiLessonComments.find((c) => c.comment_key === "c1")!.deleted_at = "2026-11-10T00:00:00Z";
    await w.repos.courseComments.moderate(ids.get("kl-1/c3")!, "delete", MEMBER);
    const removing = await course(w);

    expect(removing).toMatchObject({ updated: 1, removed: 1, restored: 0, unchanged: 2 });
    const c1 = stored(w.data).find((r) => r.source_key === "kl-1/c1")!;
    expect(new Date(c1.deleted_at!).toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(c1.deleted_by).toBeNull();
    expect(stored(w.data).find((r) => r.source_key === "kl-1/c3")).toMatchObject({ deleted_by: MEMBER });
    expect((await w.repos.courseComments.threadFor(L1, { memberId: MEMBER, isStaff: false })).count).toBe(1);

    // Kajabi lists c1 again: it comes back; c3 stays deleted.
    w.data.kajabiLessonComments.find((c) => c.comment_key === "c1")!.deleted_at = null;
    const restoring = await course(w);

    expect(restoring).toMatchObject({ updated: 1, restored: 1 });
    expect(stored(w.data).find((r) => r.source_key === "kl-1/c1")!.deleted_at).toBeNull();
    expect(stored(w.data).find((r) => r.source_key === "kl-1/c3")!.deleted_at).not.toBeNull();
    expect(await course(w)).toMatchObject({ updated: 0, inserted: 0 });
  });

  it("imports comments past 1,000 and does not duplicate them on a second run", async () => {
    const many = Array.from({ length: 1100 }, (_, i) => bronze("kl-1", `m${i}`));
    const w = world(many);

    expect(await course(w)).toMatchObject({ commentsInBronze: 1100, inserted: 1100 });
    expect(await course(w)).toMatchObject({ inserted: 0, unchanged: 1100 });
    expect(stored(w.data)).toHaveLength(1100);
  });

  it("leaves comments written in the Hub alone, and a staff reply under an imported comment notifies no one", async () => {
    const w = world([bronze("kl-1", "c1")]);
    await w.repos.courseComments.create({ lessonId: L1, memberId: MEMBER, parentId: null, body: "Mine", isStaffReply: false });
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
