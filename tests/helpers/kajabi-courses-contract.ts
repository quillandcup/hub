import { describe, it, expect, beforeEach } from "vitest";
import type { KajabiCourseRepository } from "@/lib/data/kajabi-courses";

export type KajabiCoursesContractContext = {
  repo: () => KajabiCourseRepository;
  /** An id no other run has used. Everything a test stores carries one, so `clear` can find it. */
  unique: (label: string) => string;
  /** Removes every row this context made, in every table. */
  clear: () => Promise<void>;
};

const T1 = "2097-06-01T10:00:00.000Z";
const T2 = "2097-06-02T10:00:00.000Z";
/** Postgres writes an instant as +00:00; compare instants, not strings. */
const instant = (v: string | null) => (v === null ? null : new Date(v).toISOString());

/** Behavior every `KajabiCourseRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineKajabiCoursesContract(name: string, setup: () => KajabiCoursesContractContext) {
  describe(`${name} (KajabiCourseRepository contract)`, () => {
    let ctx: KajabiCoursesContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const course = (id: string, title = `Course ${id}`) => ({ kajabi_id: id, title, raw_payload: { id }, fetched_at: T1, deleted_at: null });
    const mod = (id: string, courseId: string, extra: { parent?: string | null; position?: number } = {}) => ({
      kajabi_id: id,
      course_kajabi_id: courseId,
      parent_kajabi_id: extra.parent ?? null,
      position: extra.position ?? 1,
      title: `Module ${id}`,
      publishing_option: "published",
      raw_payload: {},
      fetched_at: T1,
      deleted_at: null,
    });
    const lesson = (id: string, courseId: string, extra: { module?: string | null; publishing?: string | null; title?: string } = {}) => ({
      kajabi_id: id,
      course_kajabi_id: courseId,
      module_kajabi_id: extra.module ?? null,
      position: 1,
      title: extra.title ?? `Lesson ${id}`,
      publishing_option: extra.publishing === undefined ? "published" : extra.publishing,
      video_duration_seconds: 60,
      raw_payload: {},
      fetched_at: T1,
      deleted_at: null,
    });
    const file = (id: string, lessonId: string, filename: string) => ({ kajabi_id: id, lesson_kajabi_id: lessonId, filename, source_url: `https://example.com/${id}`, raw_payload: {}, fetched_at: T1, deleted_at: null });
    const progress = (courseId: string, email: string, percent: number) => ({
      course_kajabi_id: courseId,
      email,
      percent,
      logins: 2,
      started_on: "2097-01-05",
      last_activity_on: "2097-02-01",
      import_batch: "batch-1",
      source_file: "report.csv",
      deleted_at: null,
    });

    it("stores courses, reads the live ones by title, and keeps a hero through a re-import", async () => {
      const a = ctx.unique("course-a");
      const b = ctx.unique("course-b");
      const repo = ctx.repo();
      await repo.upsertCourses([course(a, "Zebra writing"), course(b, "Aardvark writing")]);

      const mine = (await repo.liveCourses()).filter((c) => [a, b].includes(c.kajabi_id));
      expect(mine.map((c) => c.kajabi_id)).toEqual([b, a]);
      expect(await repo.liveCourse(a)).toMatchObject({ kajabi_id: a, title: "Zebra writing", raw_payload: { id: a } });
      expect(await repo.liveCourse(ctx.unique("nobody"))).toBeNull();

      await repo.setCourseHero(a, "https://example.com/hero.png", T2);
      await repo.upsertCourses([{ ...course(a, "Zebra writing, renamed"), fetched_at: T2 }]);
      expect(await repo.liveCourse(a)).toMatchObject({ title: "Zebra writing, renamed", hero_image_url: "https://example.com/hero.png" });
      expect(instant((await repo.liveCourse(a))!.fetched_at)).toBe(T2);
    });

    it("soft-deletes courses together with their live children, and an upsert brings a course back", async () => {
      const c = ctx.unique("course");
      const other = ctx.unique("course-other");
      const m = ctx.unique("module");
      const l = ctx.unique("lesson");
      const repo = ctx.repo();
      await repo.upsertCourses([course(c), course(other)]);
      await repo.upsertModules([mod(m, c)]);
      await repo.upsertLessons([lesson(l, c), lesson(ctx.unique("lesson-other"), other)]);
      await repo.upsertOffers([{ course_kajabi_id: c, offer_kajabi_id: ctx.unique("offer"), offer_title: "Offer", fetched_at: T1, deleted_at: null }]);

      await repo.softDeleteCourses([c], T2);

      expect(await repo.liveCourse(c)).toBeNull();
      expect(await repo.liveCourse(other)).not.toBeNull();
      expect(await repo.liveModules(c)).toEqual([]);
      expect((await repo.liveLessonOutlines(c)).map((l) => l.kajabi_id)).toEqual([]);
      expect(await repo.liveOffers([c])).toEqual([]);
      expect((await repo.liveLessonOutlines(other)).map((l) => l.kajabi_id)).toHaveLength(1);

      await repo.upsertCourses([course(c)]);
      expect(await repo.liveCourse(c)).not.toBeNull();
      // Children stay deleted until their own import brings them back.
      expect((await repo.liveLessonOutlines(c)).map((l) => l.kajabi_id)).toEqual([]);
    });

    it("reads modules of one course or of all, and soft-deletes some of them", async () => {
      const c = ctx.unique("course");
      const m1 = ctx.unique("module-1");
      const m2 = ctx.unique("module-2");
      const repo = ctx.repo();
      await repo.upsertModules([mod(m1, c, { position: 1 }), mod(m2, c, { parent: m1, position: 2 })]);

      expect((await repo.liveModules(c)).map((m) => m.kajabi_id).sort()).toEqual([m1, m2].sort());
      expect(await repo.liveModules(c)).toContainEqual(expect.objectContaining({ kajabi_id: m2, parent_kajabi_id: m1, position: 2, publishing_option: "published" }));
      expect((await repo.liveModules()).filter((m) => m.course_kajabi_id === c)).toHaveLength(2);
      expect(((await repo.liveModules(c)).map((m) => m.kajabi_id)).sort()).toEqual([m1, m2].sort());

      await repo.softDeleteModules([m1], T2);
      expect((await repo.liveModules(c)).map((m) => m.kajabi_id)).toEqual([m2]);
      await repo.upsertModules([mod(m1, c)]);
      expect((await repo.liveModules(c)).map((m) => m.kajabi_id)).toHaveLength(2);
    });

    it("keeps a lesson's captured content when its structure is imported again, and reads it back in every shape", async () => {
      const c = ctx.unique("course");
      const l = ctx.unique("lesson");
      const repo = ctx.repo();
      await repo.upsertLessons([lesson(l, c, { title: "Intro" })]);
      expect(await repo.contentState(l)).toEqual({ kajabi_id: l, content_hash: null, video_source: null });

      await repo.saveContent(l, {
        body_html: "<p>Hello</p>",
        thumbnail_url: "https://example.com/t.png",
        video_media_id: "media-1",
        video_source: { media_id: "media-1" },
        content_hash: "hash-1",
        content_fetched_at: T2,
      });
      await repo.upsertLessons([{ ...lesson(l, c, { title: "Intro, renamed" }), fetched_at: T2 }]);

      expect(await repo.contentState(l)).toEqual({ kajabi_id: l, content_hash: "hash-1", video_source: { media_id: "media-1" } });
      const detail = (await repo.liveLesson(c, l))!;
      expect({ ...detail, content_fetched_at: instant(detail.content_fetched_at), fetched_at: instant(detail.fetched_at) }).toEqual({
        kajabi_id: l,
        title: "Intro, renamed",
        publishing_option: "published",
        body_html: "<p>Hello</p>",
        thumbnail_url: "https://example.com/t.png",
        video_media_id: "media-1",
        video_duration_seconds: 60,
        content_fetched_at: T2,
        fetched_at: T2,
      });
      expect(await repo.liveLesson(ctx.unique("other-course"), l)).toBeNull();
      expect(await repo.liveLesson(c, ctx.unique("nothing"))).toBeNull();
      expect(await repo.contentState(ctx.unique("nothing"))).toBeNull();

      const [outline] = await repo.liveLessonOutlines(c);
      expect(outline).toMatchObject({ kajabi_id: l, course_kajabi_id: c, title: "Intro, renamed", video_media_id: "media-1" });
      expect(instant(outline.content_fetched_at)).toBe(T2);
      expect(outline).not.toHaveProperty("body_html");
      const [full] = await repo.liveLessons(c);
      expect(full).toMatchObject({ kajabi_id: l, body_html: "<p>Hello</p>", content_hash: "hash-1" });
      expect((await repo.liveLessonOutlines()).some((o) => o.kajabi_id === l)).toBe(true);

      await repo.setVideoSource(l, { media_id: "media-1", download_url: "https://example.com/fresh" });
      expect((await repo.contentState(l))?.video_source).toEqual({ media_id: "media-1", download_url: "https://example.com/fresh" });
    });

    it("picks lessons to capture by course or id, leaving out drafts unless asked but keeping lessons with no publishing option", async () => {
      const c = ctx.unique("course");
      const published = ctx.unique("lesson-published");
      const draft = ctx.unique("lesson-draft");
      const unset = ctx.unique("lesson-unset");
      const gone = ctx.unique("lesson-gone");
      const repo = ctx.repo();
      await repo.upsertLessons([lesson(published, c), lesson(draft, c, { publishing: "draft" }), lesson(unset, c, { publishing: null }), lesson(gone, c)]);
      await repo.softDeleteLessons([gone], T2);

      const ids = async (options?: { includeDrafts?: boolean }) => (await repo.lessonTargets({ courseId: c }, options)).map((t) => t.kajabi_id).sort();
      expect(await ids()).toEqual([published, unset].sort());
      expect(await ids({ includeDrafts: true })).toEqual([published, draft, unset].sort());
      expect(await repo.lessonTargets({ lessonId: published })).toEqual([{ kajabi_id: published, course_kajabi_id: c, title: `Lesson ${published}`, publishing_option: "published" }]);
      expect(await repo.lessonTargets({ lessonId: draft })).toEqual([]);
      expect(await repo.lessonTargets({ lessonId: draft }, { includeDrafts: true })).toHaveLength(1);
      expect(await repo.lessonTargets({ lessonId: gone }, { includeDrafts: true })).toEqual([]);
    });

    it("reads every lesson of a course past the 1000-row limit", async () => {
      const c = ctx.unique("big-course");
      const repo = ctx.repo();
      const rows = Array.from({ length: 1105 }, (_, i) => lesson(`${c}-${String(i).padStart(4, "0")}`, c));
      await repo.upsertLessons(rows);

      const ids = (await repo.liveLessonOutlines(c)).map((l) => l.kajabi_id);
      expect(ids).toHaveLength(1105);
      expect(new Set(ids).size).toBe(1105);
      expect(await repo.liveLessonOutlines(c)).toHaveLength(1105);
      expect(await repo.liveLessons(c)).toHaveLength(1105);
      expect(await repo.lessonTargets({ courseId: c })).toHaveLength(1105);
    });

    it("mirrors lesson downloads: ordered by filename, restored by an upsert, soft-deleted when gone", async () => {
      const l1 = ctx.unique("lesson-1");
      const l2 = ctx.unique("lesson-2");
      const f1 = ctx.unique("file-1");
      const f2 = ctx.unique("file-2");
      const f3 = ctx.unique("file-3");
      const repo = ctx.repo();
      await repo.upsertFiles([file(f1, l1, "b.pdf"), file(f2, l1, "a.pdf"), file(f3, l2, "c.pdf")]);

      expect((await repo.liveFiles([l1])).map((f) => f.filename)).toEqual(["a.pdf", "b.pdf"]);
      expect((await repo.liveFiles([l1, l2, l1])).map((f) => f.filename)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
      expect(await repo.liveFiles([])).toEqual([]);
      expect(((await repo.liveFiles([l1])).map((f) => f.kajabi_id)).sort()).toEqual([f1, f2].sort());

      await repo.setFileSourceUrl(f1, "https://example.com/fresh");
      expect((await repo.liveFiles([l1])).find((f) => f.kajabi_id === f1)?.source_url).toBe("https://example.com/fresh");

      await repo.softDeleteFiles([f1], T2);
      expect((await repo.liveFiles([l1])).map((f) => f.kajabi_id)).toEqual([f2]);
      await repo.upsertFiles([file(f1, l1, "b.pdf")]);
      expect((await repo.liveFiles([l1])).map((f) => f.kajabi_id)).toHaveLength(2);
    });

    it("stores the offers that grant a course and soft-deletes some of them", async () => {
      const c1 = ctx.unique("course-1");
      const c2 = ctx.unique("course-2");
      const o1 = ctx.unique("offer-1");
      const o2 = ctx.unique("offer-2");
      const repo = ctx.repo();
      const offer = (courseId: string, offerId: string, title: string) => ({ course_kajabi_id: courseId, offer_kajabi_id: offerId, offer_title: title, fetched_at: T1, deleted_at: null });
      await repo.upsertOffers([offer(c1, o1, "One"), offer(c1, o2, "Two"), offer(c2, o1, "One")]);

      expect((await repo.liveOffers([c1])).map((o) => o.offer_kajabi_id).sort()).toEqual([o1, o2].sort());
      expect(await repo.liveOffers([c1, c2])).toHaveLength(3);
      await repo.upsertOffers([offer(c1, o1, "One, renamed")]);
      expect((await repo.liveOffers([c1])).find((o) => o.offer_kajabi_id === o1)?.offer_title).toBe("One, renamed");

      await repo.softDeleteOffers(c1, [o1], T2);
      expect((await repo.liveOffers([c1])).map((o) => o.offer_kajabi_id)).toEqual([o2]);
      expect(await repo.liveOffers([c2])).toHaveLength(1);
      await repo.upsertOffers([offer(c1, o1, "One")]);
      expect(await repo.liveOffers([c1])).toHaveLength(2);
    });

    it("keeps a course's Product Progress snapshot, soft-deleted rows included, and reads a student's best percent", async () => {
      const c = ctx.unique("course");
      const other = ctx.unique("course-other");
      const repo = ctx.repo();
      await repo.upsertProductProgress([progress(c, "bo@example.com", 40), progress(c, "ada@example.com", 75), progress(c, "ada.alias@example.com", 90), progress(other, "ada@example.com", 10)]);

      expect((await repo.productProgress(c)).map((p) => p.email)).toEqual(["ada.alias@example.com", "ada@example.com", "bo@example.com"]);
      expect(await repo.productProgress(c)).toContainEqual({ email: "ada@example.com", percent: 75, logins: 2, started_on: "2097-01-05", last_activity_on: "2097-02-01", deleted_at: null });

      expect(await repo.bestProductProgress(c, ["ada@example.com", "ada.alias@example.com"])).toMatchObject({ percent: 90, logins: 2, started_on: "2097-01-05", last_activity_on: "2097-02-01" });
      expect(await repo.bestProductProgress(c, ["nobody@example.com"])).toBeNull();
      expect(await repo.bestProductProgress(c, [])).toBeNull();

      await repo.softDeleteProductProgress(c, ["ada.alias@example.com"], T2, "batch-2");
      expect(await repo.bestProductProgress(c, ["ada@example.com", "ada.alias@example.com"])).toMatchObject({ percent: 75 });
      const stored = await repo.productProgress(c);
      expect(stored.find((p) => p.email === "ada.alias@example.com")?.deleted_at).not.toBeNull();
      expect(stored.find((p) => p.email === "bo@example.com")?.deleted_at).toBeNull();
      expect((await repo.productProgress(other)).map((p) => p.deleted_at)).toEqual([null]);

      await repo.upsertProductProgress([progress(c, "ada.alias@example.com", 95)]);
      expect(await repo.bestProductProgress(c, ["ada.alias@example.com"])).toMatchObject({ percent: 95 });
    });

    it("keeps one student's lesson progress, reads the completed lessons of a course, and soft-deletes lessons", async () => {
      const c = ctx.unique("course");
      const repo = ctx.repo();
      const entry = (email: string, lessonId: string, completed: boolean, extra: Record<string, unknown> = {}) => ({
        course_kajabi_id: c,
        email,
        kajabi_lesson_id: lessonId,
        completed,
        completed_at: completed ? T1 : null,
        percent: completed ? 100 : 20,
        captured_at: T1,
        deleted_at: null,
        ...extra,
      });
      await repo.upsertLessonProgress([
        entry("ada@example.com", "l-2", true, { kajabi_contact_id: "contact-1", kajabi_member_id: "member-1" }),
        entry("ada@example.com", "l-1", false),
        entry("ada@example.com", "l-3", true),
        entry("bo@example.com", "l-1", true),
      ]);

      const stored = await repo.lessonProgress(c, "ada@example.com");
      expect(stored.map((s) => s.kajabi_lesson_id)).toEqual(["l-1", "l-2", "l-3"]);
      expect(stored[1]).toMatchObject({ kajabi_contact_id: "contact-1", kajabi_member_id: "member-1", completed: true, deleted_at: null });
      expect(Number(stored[0].percent)).toBe(20);
      const completed = await repo.completedLessons(c);
      expect(completed.map((r) => `${r.email}/${r.kajabi_lesson_id}`)).toEqual(["ada@example.com/l-2", "ada@example.com/l-3", "bo@example.com/l-1"]);
      expect(completed.map((r) => [instant(r.completed_at), instant(r.captured_at)])).toEqual([[T1, T1], [T1, T1], [T1, T1]]);

      await repo.softDeleteLessonProgress(c, "ada@example.com", ["l-3"], T2);
      expect((await repo.completedLessons(c)).map((r) => `${r.email}/${r.kajabi_lesson_id}`)).toEqual(["ada@example.com/l-2", "bo@example.com/l-1"]);
      expect((await repo.lessonProgress(c, "ada@example.com")).find((s) => s.kajabi_lesson_id === "l-3")?.deleted_at).not.toBeNull();
      expect((await repo.lessonProgress(c, "bo@example.com"))[0].deleted_at).toBeNull();
    });

    it("reads a course's lesson comments for the import, removed ones included, past 1,000, and no other course's", async () => {
      const repo = ctx.repo();
      const c = ctx.unique("comments-course");
      const other = ctx.unique("comments-other");
      const l1 = ctx.unique("cl1");
      const l2 = ctx.unique("cl2");
      const comment = (course: string, lesson: string, key: string, over: Record<string, unknown> = {}) => ({ course_kajabi_id: course, lesson_kajabi_id: lesson, comment_key: key, author_name: "Ada Example", body: `Text ${key}`, ...over });

      await repo.upsertLessonComments([
        comment(c, l2, "b", { parent_comment_key: "a", posted_at: T1 }),
        comment(c, l1, "a", { posted_at: T1 }),
        comment(c, l2, "a"),
        comment(other, ctx.unique("cl9"), "a"),
      ]);
      await repo.softDeleteLessonComments(l2, ["a"], T2);

      const rows = await repo.commentsOfCourse(c);

      expect(rows.map((r) => `${r.lesson_kajabi_id}/${r.comment_key}`).sort()).toEqual([`${l1}/a`, `${l2}/a`, `${l2}/b`].sort());
      const removed = rows.find((r) => r.lesson_kajabi_id === l2 && r.comment_key === "a")!;
      expect(instant(removed.deleted_at!)).toBe(T2);
      const reply = rows.find((r) => r.comment_key === "b")!;
      expect(reply).toMatchObject({ parent_comment_key: "a", author_name: "Ada Example", body: "Text b" });
      expect(instant(reply.posted_at!)).toBe(T1);
      expect(typeof reply.captured_at).toBe("string");
      expect(await repo.commentsOfCourse(ctx.unique("none"))).toEqual([]);

      const many = Array.from({ length: 1050 }, (_, i) => comment(other, l1, `m${String(i).padStart(4, "0")}`));
      await repo.upsertLessonComments(many);
      expect(await repo.commentsOfCourse(other)).toHaveLength(1051);
    });

    it("keeps a course's quizzes, rewrites one that changed, restores one that came back, and retires the quizzes of a lesson that is plain again", async () => {
      const repo = ctx.repo();
      const c = ctx.unique("quiz-course");
      const other = ctx.unique("quiz-other-course");
      const quiz = (id: string, courseId: string, lessonId: string, hash: string) => ({ kajabi_id: id, course_kajabi_id: courseId, lesson_kajabi_id: lessonId, raw_payload: { documents: [{ hash }] }, content_hash: hash });
      const q1 = ctx.unique("q1");
      const q2 = ctx.unique("q2");
      const l1 = ctx.unique("l1");
      const l2 = ctx.unique("l2");

      await repo.saveQuiz(quiz(q1, c, l1, "hash-a"));
      await repo.saveQuiz(quiz(q2, c, l2, "hash-b"));
      await repo.saveQuiz(quiz(ctx.unique("elsewhere"), other, ctx.unique("l9"), "hash-z"));
      expect((await repo.liveQuizzes(c)).map((q) => [q.kajabi_id, q.lesson_kajabi_id, q.content_hash])).toEqual([[q1, l1, "hash-a"], [q2, l2, "hash-b"]].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
      expect(await repo.quizContentHash(q1)).toBe("hash-a");
      expect(await repo.quizContentHash(ctx.unique("never"))).toBeNull();

      await repo.saveQuiz(quiz(q1, c, l1, "hash-a2"));
      expect(await repo.quizContentHash(q1)).toBe("hash-a2");
      expect((await repo.liveQuizzes(c)).find((q) => q.kajabi_id === q1)?.raw_payload).toEqual({ documents: [{ hash: "hash-a2" }] });
      expect(await repo.liveQuizzes(c)).toHaveLength(2);

      expect(await repo.softDeleteQuizzesOfLesson(l1, T2)).toBe(1);
      expect(await repo.softDeleteQuizzesOfLesson(l1, T2)).toBe(0);
      expect((await repo.liveQuizzes(c)).map((q) => q.kajabi_id)).toEqual([q2]);
      expect(await repo.quizContentHash(q1)).toBeNull();

      await repo.saveQuiz(quiz(q1, c, l1, "hash-a2"));
      expect((await repo.liveQuizzes(c)).map((q) => q.kajabi_id).sort()).toEqual([q1, q2].sort());
    });
  });
}
