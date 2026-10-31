import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CourseProgressRepository } from "@/lib/data/course-progress";
import { newCourseId, type CourseRepository } from "@/lib/data/courses";
import type { Row } from "@/lib/data/db";
import { compareText } from "@/lib/data/query";
import { accessRow, courseRow, fileRow, lessonRow, moduleRow, progressRow, videoRow } from "@/tests/helpers/course-fixtures";

/** Where a contract run puts its rows: straight into the dataset (twin) or the tables (database), by whatever means the context chooses. */
export type CourseSeeder = {
  courses: (rows: Row<"courses">[]) => Promise<void>;
  modules: (rows: Row<"course_modules">[]) => Promise<void>;
  lessons: (rows: Row<"course_lessons">[]) => Promise<void>;
  files: (rows: Row<"course_lesson_files">[]) => Promise<void>;
  videos: (rows: Row<"videos">[]) => Promise<void>;
  progress: (rows: Row<"lesson_progress">[]) => Promise<void>;
  access: (rows: Row<"course_access">[]) => Promise<void>;
};

export type CourseContractContext = {
  courses: () => CourseRepository;
  progress: () => CourseProgressRepository;
  /** A string no other run has used, safe in a slug. */
  unique: (label: string) => string;
  /** Two members that exist, to have progress and access. */
  members: () => Promise<[string, string]>;
  seed: CourseSeeder;
};

const T = (n: number) => `2097-03-0${n}T10:00:00.000Z`;
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/** Behavior every `CourseRepository` and `CourseProgressRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineCourseContract(name: string, setup: () => CourseContractContext) {
  describe(`${name} (CourseRepository + CourseProgressRepository contract)`, () => {
    let ctx: CourseContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    /** A published Hub course with a unique address. */
    const newCourse = (label: string, over: Partial<Row<"courses">> = {}) => courseRow({ id: newCourseId("crs"), slug: ctx.unique(label), title: `Course ${label}`, ...over });

    it("finds a course by id and by address, narrowed by source and draft", async () => {
      const hub = newCourse("hub");
      const draft = newCourse("draft", { source: "kajabi", source_key: ctx.unique("kj"), is_draft: true });
      await ctx.seed.courses([hub, draft]);
      const repo = ctx.courses();

      expect(await repo.courseById(hub.id)).toMatchObject({ id: hub.id, slug: hub.slug, source: "hub", is_draft: false });
      expect(await repo.courseById(newCourseId("crs"))).toBeNull();
      expect((await repo.courseBySlug(hub.slug))?.id).toBe(hub.id);
      expect(await repo.courseBySlug(hub.slug, { source: "hub", isDraft: false })).not.toBeNull();
      expect(await repo.courseBySlug(hub.slug, { source: "kajabi" })).toBeNull();
      expect(await repo.courseBySlug(draft.slug, { isDraft: false })).toBeNull();
      expect((await repo.courseBySlug(draft.slug, { isDraft: true }))?.id).toBe(draft.id);
      expect(await repo.courseBySlug(ctx.unique("nobody"))).toBeNull();
    });

    it("lists courses by address, filtered by source, draft and ids", async () => {
      const a = newCourse("a-hub", { slug: `${ctx.unique("zz")}-b` });
      const b = newCourse("b-hub", { slug: `${ctx.unique("zz")}-a` });
      const k = newCourse("kajabi", { source: "kajabi", source_key: ctx.unique("kj"), is_draft: true });
      await ctx.seed.courses([a, b, k]);
      const repo = ctx.courses();
      const mine = new Set([a.id, b.id, k.id]);
      const only = (rows: { id: string }[]) => ids(rows).filter((id) => mine.has(id));

      expect(only(await repo.courses({ source: "hub" }))).toEqual([a, b].sort((x, y) => compareText(x.slug, y.slug)).map((c) => c.id));
      expect(only(await repo.courses({ source: "kajabi", isDraft: true }))).toEqual([k.id]);
      expect(only(await repo.courses({ isDraft: false }))).toHaveLength(2);
      expect(only(await repo.courses())).toHaveLength(3);
      expect(ids(await repo.courses({ ids: [k.id, a.id] })).sort()).toEqual([k.id, a.id].sort());
      expect(await repo.courses({ ids: [] })).toEqual([]);
    });

    it("reads the modules and lessons of courses by id, leaving hidden ones out unless asked, and never returns a lesson's text", async () => {
      const c1 = newCourse("c1");
      const c2 = newCourse("c2");
      await ctx.seed.courses([c1, c2]);
      const m1 = moduleRow({ id: newCourseId("mod"), course_id: c1.id, title: "Open module" });
      const m2 = moduleRow({ id: newCourseId("mod"), course_id: c1.id, title: "Hidden module", state: "hidden", source: "kajabi", source_key: ctx.unique("km") });
      const m3 = moduleRow({ id: newCourseId("mod"), course_id: c2.id, title: "Other course" });
      await ctx.seed.modules([m1, m2, m3]);
      const l1 = lessonRow({ id: newCourseId("les"), course_id: c1.id, module_id: m1.id, title: "One", body_html: "<p>secret text</p>", excerpt: "secret" });
      const l2 = lessonRow({ id: newCourseId("les"), course_id: c1.id, title: "Hidden", state: "hidden", source: "kajabi", source_key: ctx.unique("kl") });
      const l3 = lessonRow({ id: newCourseId("les"), course_id: c1.id, title: "Soon", state: "coming_soon" });
      const l4 = lessonRow({ id: newCourseId("les"), course_id: c2.id, title: "Elsewhere" });
      await ctx.seed.lessons([l1, l2, l3, l4]);
      const repo = ctx.courses();
      const byId = (rows: { id: string }[]) => ids(rows).sort(compareText);

      expect(ids(await repo.modulesOf([c1.id]))).toEqual([m1.id]);
      expect(byId(await repo.modulesOf([c1.id], { includeHidden: true }))).toEqual([m1.id, m2.id].sort(compareText));
      expect(byId(await repo.modulesOf([c1.id, c2.id]))).toEqual([m1.id, m3.id].sort(compareText));
      expect(ids(await repo.modulesOf([c1.id], { includeHidden: true, source: "kajabi" }))).toEqual([m2.id]);
      expect(await repo.modulesOf([])).toEqual([]);

      const lessons = await repo.lessonsOf([c1.id]);
      expect(byId(lessons)).toEqual([l1.id, l3.id].sort(compareText));
      expect(ids(lessons)).toEqual(ids(lessons).slice().sort(compareText));
      expect(lessons.find((l) => l.id === l1.id)).toMatchObject({ title: "One", module_id: m1.id, excerpt: "secret", state: "open" });
      expect("body_html" in lessons[0]).toBe(false);
      expect(byId(await repo.lessonsOf([c1.id], { includeHidden: true }))).toEqual([l1.id, l2.id, l3.id].sort(compareText));
      expect(ids(await repo.lessonsOf([c1.id], { includeHidden: true, source: "kajabi" }))).toEqual([l2.id]);
      expect(byId(await repo.lessonsOf([c1.id, c2.id]))).toEqual([l1.id, l3.id, l4.id].sort(compareText));
      expect(await repo.lessonsOf([])).toEqual([]);
    });

    it("reads every lesson of a course past the 1000-row cap", async () => {
      const course = newCourse("big");
      await ctx.seed.courses([course]);
      const lessons = Array.from({ length: 1005 }, (_, i) => lessonRow({ id: newCourseId("les"), course_id: course.id, title: `Lesson ${i}`, position: i }));
      await ctx.seed.lessons(lessons);
      const read = await ctx.courses().lessonsOf([course.id]);
      expect(read).toHaveLength(1005);
      expect(new Set(ids(read)).size).toBe(1005);
    });

    it("reads one lesson, its text, and the open ones among a set", async () => {
      const course = newCourse("lessons");
      await ctx.seed.courses([course]);
      const video = videoRow({ id: randomUUID(), source_key: ctx.unique("media"), status: "ready", mux_playback_id: "playback-1", duration_seconds: 90 });
      await ctx.seed.videos([video]);
      const open = lessonRow({ id: newCourseId("les"), course_id: course.id, title: "Open", body_html: "<p>Hello</p>", video_id: video.id });
      const soon = lessonRow({ id: newCourseId("les"), course_id: course.id, title: "Soon", state: "coming_soon" });
      const bare = lessonRow({ id: newCourseId("les"), course_id: course.id, title: "Bare" });
      await ctx.seed.lessons([open, soon, bare]);
      const repo = ctx.courses();

      expect(await repo.lessonById(open.id)).toMatchObject({ id: open.id, title: "Open", course_id: course.id, video_id: video.id, state: "open" });
      expect("body_html" in (await repo.lessonById(open.id))!).toBe(false);
      expect(await repo.lessonById(newCourseId("les"))).toBeNull();
      expect(await repo.lessonBody(open.id)).toEqual({ body_html: "<p>Hello</p>", video_id: video.id });
      expect(await repo.lessonBody(bare.id)).toEqual({ body_html: null, video_id: null });
      expect(await repo.lessonBody(newCourseId("les"))).toBeNull();
      expect(ids(await repo.openLessons([open.id, soon.id, bare.id])).sort(compareText)).toEqual([open.id, bare.id].sort(compareText));
      expect(await repo.openLessons([])).toEqual([]);
      expect(await repo.video(video.id)).toMatchObject({ id: video.id, status: "ready", mux_playback_id: "playback-1" });
      expect(await repo.video(randomUUID())).toBeNull();
    });

    it("lists a lesson's downloads in order and finds one of them", async () => {
      const course = newCourse("files");
      await ctx.seed.courses([course]);
      const lesson = lessonRow({ id: newCourseId("les"), course_id: course.id, title: "With files" });
      const other = lessonRow({ id: newCourseId("les"), course_id: course.id, title: "Without" });
      await ctx.seed.lessons([lesson, other]);
      const second = fileRow({ id: newCourseId("file"), lesson_id: lesson.id, filename: "second.pdf", position: 2, source_key: ctx.unique("src") });
      const first = fileRow({ id: newCourseId("file"), lesson_id: lesson.id, filename: "first.pdf", position: 1, source_key: ctx.unique("src") });
      await ctx.seed.files([second, first]);
      const repo = ctx.courses();

      expect((await repo.lessonFiles(lesson.id)).map((f) => f.filename)).toEqual(["first.pdf", "second.pdf"]);
      expect(await repo.lessonFiles(other.id)).toEqual([]);
      expect(await repo.lessonFile(lesson.id, first.id)).toMatchObject({ id: first.id, filename: "first.pdf", storage_path: first.storage_path });
      expect(await repo.lessonFile(other.id, first.id)).toBeNull();
      expect(await repo.lessonFile(lesson.id, newCourseId("file"))).toBeNull();
    });

    it("reads a member's access, with or without a set of courses, and everyone's access to courses", async () => {
      const [m1, m2] = await ctx.members();
      const c1 = newCourse("access-1");
      const c2 = newCourse("access-2");
      await ctx.seed.courses([c1, c2]);
      const a1 = accessRow({ member_id: m1, course_id: c1.id, starts_at: T(1), ends_at: T(5) });
      const a2 = accessRow({ member_id: m1, course_id: c2.id, starts_at: T(2), ends_at: null, origin: "grant" });
      const a3 = accessRow({ member_id: m2, course_id: c1.id, starts_at: T(3) });
      await ctx.seed.access([a1, a2, a3]);
      const progress = ctx.progress();
      const key = (rows: { member_id: string; course_id: string }[]) => rows.map((r) => `${r.member_id}|${r.course_id}`);

      expect(key(await progress.memberAccess(m1)).sort()).toEqual(key([a1, a2]).sort());
      expect(key(await progress.memberAccess(m1, [c2.id]))).toEqual(key([a2]));
      expect(await progress.memberAccess(m1, [])).toEqual([]);
      expect(await progress.memberAccess(m1, [c2.id])).toEqual([expect.objectContaining({ origin: "grant", ends_at: null })]);
      expect(key(await progress.accessOfCourses([c1.id]))).toEqual(key([a1, a3]).sort());
      expect(key(await progress.accessOfCourses([c1.id, c2.id]))).toHaveLength(3);
      expect(await progress.accessOfCourses([])).toEqual([]);
    });

    it("tells which lessons a member completed, where they left off, and what they have half-watched", async () => {
      const [m1, m2] = await ctx.members();
      const course = newCourse("progress");
      await ctx.seed.courses([course]);
      const lessons = ["a", "b", "c", "d"].map((t) => lessonRow({ id: newCourseId("les"), course_id: course.id, title: t }));
      await ctx.seed.lessons(lessons);
      const [a, b, c, d] = lessons;
      await ctx.seed.progress([
        progressRow({ member_id: m1, lesson_id: a.id, completed_at: T(1), last_position_seconds: 50 }),
        progressRow({ member_id: m1, lesson_id: b.id, last_position_seconds: 30, updated_at: T(2) }),
        progressRow({ member_id: m1, lesson_id: c.id, last_position_seconds: 12.5, updated_at: T(4) }),
        progressRow({ member_id: m1, lesson_id: d.id, last_position_seconds: 0, updated_at: T(5) }),
        progressRow({ member_id: m2, lesson_id: b.id, completed_at: T(3) }),
      ]);
      const progress = ctx.progress();

      expect([...(await progress.completedLessonIds(m1, ids(lessons)))]).toEqual([a.id]);
      expect([...(await progress.completedLessonIds(m2, ids(lessons)))]).toEqual([b.id]);
      expect((await progress.completedLessonIds(m1, [])).size).toBe(0);

      // Not completed, a saved position, most recently touched first.
      expect(await progress.partlyWatched(m1, 10)).toEqual([
        { lesson_id: c.id, last_position_seconds: 12.5 },
        { lesson_id: b.id, last_position_seconds: 30 },
      ]);
      expect(await progress.partlyWatched(m1, 1)).toEqual([{ lesson_id: c.id, last_position_seconds: 12.5 }]);
      expect(await progress.partlyWatched(m2, 10)).toEqual([]);

      expect(await progress.lessonPosition(m1, b.id)).toBe(30);
      expect(await progress.lessonPosition(m1, d.id)).toBe(0);
      expect(await progress.lessonPosition(m2, a.id)).toBeNull();
    });
  });
}
