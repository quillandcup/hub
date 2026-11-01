import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CourseProgressRepository } from "@/lib/data/course-progress";
import { newCourseId, type CourseRepository } from "@/lib/data/courses";
import type { Row } from "@/lib/data/db";
import { compareText } from "@/lib/data/query";
import { accessRow, courseRow, fileRow, grantRow, lessonRow, moduleRow, progressRow, videoRow } from "@/tests/helpers/course-fixtures";

/** Where a contract run puts its rows: straight into the dataset (twin) or the tables (database), by whatever means the context chooses. */
export type CourseSeeder = {
  courses: (rows: Row<"courses">[]) => Promise<void>;
  modules: (rows: Row<"course_modules">[]) => Promise<void>;
  lessons: (rows: Row<"course_lessons">[]) => Promise<void>;
  files: (rows: Row<"course_lesson_files">[]) => Promise<void>;
  videos: (rows: Row<"videos">[]) => Promise<void>;
  progress: (rows: Row<"lesson_progress">[]) => Promise<void>;
  access: (rows: Row<"course_access">[]) => Promise<void>;
  grants: (rows: Row<"course_access_grants">[]) => Promise<void>;
  /** A library image a course, module or lesson can show. */
  mediaAsset: () => Promise<string>;
  /** Rows the repository (not `seed`) created, so the context can remove them afterwards. */
  forget: (ids: { courses?: string[]; videos?: string[] }) => void;
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
/** Postgres writes an instant as +00:00; compare instants, not strings. */
const instant = (v: string | null) => (v === null ? null : new Date(v).toISOString());

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
      expect(await repo.videosByIds([video.id])).toMatchObject([{ id: video.id, status: "ready", mux_playback_id: "playback-1" }]);
      expect(await repo.videosByIds([randomUUID()])).toEqual([]);
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
      expect(await progress.hasProgressIn(ids(lessons))).toBe(true);
      expect(await progress.hasProgressIn([newCourseId("les")])).toBe(false);
      expect(await progress.hasProgressIn([])).toBe(false);
    });

    it("creates courses, finds one by where it came from, and changes it only where the filter allows", async () => {
      const repo = ctx.courses();
      const slug = ctx.unique("created");
      const created = await repo.createCourse({ slug, title: "Created", source: "hub" });
      expect(created).toMatchObject({ slug, title: "Created", source: "hub", kind: "evergreen", is_draft: false, source_key: null });
      expect(created.id).toMatch(/^crs_/);
      await ctx.seed.forget({ courses: [created.id] });

      const key = ctx.unique("kj");
      const imported = await repo.createCourse({ slug: ctx.unique("imported"), title: "Imported", source: "kajabi", source_key: key, is_draft: true });
      await ctx.seed.forget({ courses: [imported.id] });
      expect((await repo.courseBySource("kajabi", key))?.id).toBe(imported.id);
      expect(await repo.courseBySource("hub", key)).toBeNull();

      await expect(repo.createCourse({ slug, title: "Same address", source: "hub" })).rejects.toMatchObject({ code: "23505" });

      expect(await repo.updateCourse(created.id, { title: "Renamed", description: "About" }, { source: "hub" })).toMatchObject({ id: created.id, title: "Renamed", description: "About", slug });
      expect(await repo.updateCourse(imported.id, { title: "Nope" }, { source: "hub" })).toBeNull();
      expect((await repo.courseById(imported.id))?.title).toBe("Imported");
      expect(await repo.updateCourse(imported.id, { is_draft: false, title: "Published" })).toMatchObject({ is_draft: false, title: "Published" });
      expect(await repo.updateCourse(newCourseId("crs"), { title: "Ghost" })).toBeNull();
      await expect(repo.updateCourse(created.id, { slug: imported.slug })).rejects.toMatchObject({ code: "23505" });

      const drafts = ["a", "b"].map((t) => ({ slug: ctx.unique(`draft-${t}`), title: `Draft ${t}`, source: "kajabi", source_key: ctx.unique(`dk-${t}`), is_draft: true }));
      await repo.createCourses(drafts);
      for (const d of drafts) {
        const row = await repo.courseBySlug(d.slug);
        expect(row).toMatchObject({ is_draft: true, source: "kajabi" });
        await ctx.seed.forget({ courses: [row!.id] });
      }
      await repo.createCourses([]);
    });

    it("upserts modules and lessons on their source key, keeping the columns a re-run leaves out, and deletes with what hangs off them", async () => {
      const course = newCourse("sync", { source: "kajabi", source_key: ctx.unique("kj") });
      await ctx.seed.courses([course]);
      const repo = ctx.courses();
      const [m1] = await ctx.members();
      const root = ctx.unique("root");
      const child = ctx.unique("child");

      const first = await repo.upsertModules([{ course_id: course.id, title: "Root", position: 1, state: "open", source: "kajabi", source_key: root, parent_id: null }]);
      expect([...first.keys()]).toEqual([root]);
      const rootId = first.get(root)!;
      const nested = await repo.upsertModules([{ course_id: course.id, title: "Child", position: 1, state: "coming_soon", source: "kajabi", source_key: child }]);
      const childId = nested.get(child)!;
      await repo.upsertModules([{ course_id: course.id, title: "Child", position: 1, state: "coming_soon", source: "kajabi", source_key: child, parent_id: rootId }]);
      // A re-run without parent_id leaves the link; with new values it updates the row, same id.
      const again = await repo.upsertModules([{ course_id: course.id, title: "Child renamed", position: 2, state: "open", source: "kajabi", source_key: child }]);
      expect(again.get(child)).toBe(childId);
      const modules = await repo.modulesOf([course.id]);
      expect(modules.find((m) => m.id === childId)).toMatchObject({ title: "Child renamed", position: 2, state: "open", parent_id: rootId });
      expect(modules).toHaveLength(2);
      expect(await repo.upsertModules([])).toEqual(new Map());

      const video = videoRow({ id: randomUUID(), source_key: ctx.unique("media") });
      await ctx.seed.videos([video]);
      const lessonKey = ctx.unique("lesson");
      const lessons = await repo.upsertLessons([{ course_id: course.id, module_id: childId, title: "Lesson", position: 1, state: "open", body_html: "<p>x</p>", source: "kajabi", source_key: lessonKey, video_id: video.id }]);
      const lessonId = lessons.get(lessonKey)!;
      await repo.upsertLessons([{ course_id: course.id, module_id: childId, title: "Lesson v2", position: 3, state: "coming_soon", source: "kajabi", source_key: lessonKey }]);
      expect(await repo.lessonById(lessonId)).toMatchObject({ title: "Lesson v2", position: 3, state: "coming_soon", video_id: video.id });
      expect(await repo.lessonBody(lessonId)).toEqual({ body_html: "<p>x</p>", video_id: video.id });
      expect(await repo.upsertLessons([])).toEqual(new Map());

      // Past one write chunk.
      const many = Array.from({ length: 501 }, (_, i) => ({ course_id: course.id, title: `L${i}`, position: i, source: "kajabi", source_key: `${lessonKey}-${i}` }));
      expect((await repo.upsertLessons(many)).size).toBe(501);

      await ctx.seed.files([fileRow({ id: newCourseId("file"), lesson_id: lessonId, filename: "a.pdf", source_key: ctx.unique("src") })]);
      await ctx.seed.progress([progressRow({ member_id: m1, lesson_id: lessonId, completed_at: T(1) })]);
      await repo.deleteLessons([lessonId, ...[...(await repo.upsertLessons(many)).values()]]);
      expect(await repo.lessonById(lessonId)).toBeNull();
      expect(await repo.lessonFiles(lessonId)).toEqual([]);
      expect(await ctx.progress().lessonPosition(m1, lessonId)).toBeNull();
      expect(await repo.lessonsOf([course.id], { includeHidden: true })).toEqual([]);
      await repo.deleteLessons([]);

      await repo.deleteModules([rootId]);
      expect(await repo.modulesOf([course.id])).toEqual([]);
      await repo.deleteModules([]);
    });

    it("adds, renames, counts under and deletes the items of a Hub course, and only a Hub course's", async () => {
      const hub = newCourse("editor");
      const imported = newCourse("editor-kajabi", { source: "kajabi", source_key: ctx.unique("kj") });
      await ctx.seed.courses([hub, imported]);
      const repo = ctx.courses();
      const [m1] = await ctx.members();

      expect(await repo.nextPosition("module", hub.id, null)).toBe(1);
      const a = await repo.addModule({ course_id: hub.id, title: "A", position: await repo.nextPosition("module", hub.id, null), state: "hidden", source: "hub" });
      const b = await repo.addModule({ course_id: hub.id, title: "B", position: await repo.nextPosition("module", hub.id, null), state: "hidden", source: "hub" });
      const sub = await repo.addModule({ course_id: hub.id, parent_id: a, title: "Sub", position: await repo.nextPosition("module", hub.id, a), state: "hidden", source: "hub" });
      const hubModule = async (id: string) => (await repo.modulesOf([hub.id], { includeHidden: true })).find((m) => m.id === id) ?? null;
      expect((await hubModule(b))?.position).toBe(2);
      expect(await repo.nextPosition("module", hub.id, null)).toBe(3);
      expect(await repo.nextPosition("module", hub.id, a)).toBe(2);

      expect(await repo.nextPosition("lesson", hub.id, a)).toBe(1);
      const l1 = await repo.addLesson({ course_id: hub.id, module_id: a, title: "One", position: 1, state: "hidden", source: "hub" });
      const l2 = await repo.addLesson({ course_id: hub.id, module_id: sub, title: "Two", position: 1, state: "hidden", source: "hub" });
      const loose = await repo.addLesson({ course_id: hub.id, module_id: null, title: "Loose", position: await repo.nextPosition("lesson", hub.id, null), state: "hidden", source: "hub" });
      expect(await repo.nextPosition("lesson", hub.id, a)).toBe(2);
      expect(await repo.nextPosition("lesson", hub.id, null)).toBe(2);
      expect(loose).toMatch(/^les_/);

      expect(await repo.renameItem("module", { id: a, courseId: hub.id }, "A renamed")).toBe(true);
      expect(await repo.renameItem("lesson", { id: l1, courseId: hub.id }, "One renamed")).toBe(true);
      expect((await hubModule(a))?.title).toBe("A renamed");
      expect((await repo.lessonById(l1))?.title).toBe("One renamed");
      expect(await repo.renameItem("lesson", { id: l1, courseId: imported.id }, "Wrong course")).toBe(false);
      expect(await repo.renameItem("module", { id: newCourseId("mod"), courseId: hub.id }, "Nobody")).toBe(false);

      const importedLesson = lessonRow({ id: newCourseId("les"), course_id: imported.id, title: "Imported", source: "kajabi", source_key: ctx.unique("kl") });
      await ctx.seed.lessons([importedLesson]);
      expect(await repo.renameItem("lesson", { id: importedLesson.id, courseId: imported.id }, "Edited")).toBe(false);
      expect(await repo.deleteItem("lesson", { id: importedLesson.id, courseId: imported.id })).toBe(false);
      expect((await repo.lessonById(importedLesson.id))?.title).toBe("Imported");

      expect((await repo.lessonIdsUnder("module", a)).sort()).toEqual([l1, l2].sort());
      expect(await repo.lessonIdsUnder("lesson", loose)).toEqual([loose]);
      expect(await repo.lessonIdsUnder("module", b)).toEqual([]);

      await ctx.seed.progress([progressRow({ member_id: m1, lesson_id: l2 })]);
      expect(await ctx.progress().hasProgressIn(await repo.lessonIdsUnder("module", a))).toBe(true);

      expect(await repo.deleteItem("lesson", { id: loose, courseId: hub.id })).toBe(true);
      expect(await repo.lessonById(loose)).toBeNull();
      expect(await repo.deleteItem("lesson", { id: loose, courseId: hub.id })).toBe(false);
      expect(await repo.deleteItem("module", { id: a, courseId: hub.id })).toBe(true);
      expect(await hubModule(sub)).toBeNull();
      expect(await repo.lessonById(l2)).toBeNull();
      expect(await hubModule(b)).not.toBeNull();
    });

    it("duplicates a lesson or a module as drafts at the end, and reorders children all or nothing", async () => {
      const course = newCourse("dup");
      await ctx.seed.courses([course]);
      const repo = ctx.courses();
      const m = await repo.addModule({ course_id: course.id, title: "Module", position: 1, state: "open", source: "hub" });
      const sub = await repo.addModule({ course_id: course.id, parent_id: m, title: "Week", position: 1, state: "open", source: "hub" });
      const l1 = await repo.addLesson({ course_id: course.id, module_id: m, title: "First", position: 1, state: "open", body_html: "<p>text</p>", excerpt: "text", source: "hub" });
      const l2 = await repo.addLesson({ course_id: course.id, module_id: m, title: "Second", position: 2, state: "open", source: "hub" });
      await repo.addLesson({ course_id: course.id, module_id: sub, title: "Nested", position: 1, state: "open", source: "hub" });

      const lessonCopy = await repo.duplicateItem("lesson", l1);
      expect(await repo.lessonById(lessonCopy)).toMatchObject({ title: "First (copy)", state: "hidden", module_id: m, position: 3, source: "hub" });
      expect(await repo.lessonBody(lessonCopy)).toMatchObject({ body_html: "<p>text</p>" });
      await expect(repo.duplicateItem("lesson", newCourseId("les"))).rejects.toThrow("not_found");
      await expect(repo.duplicateItem("module", newCourseId("mod"))).rejects.toThrow("not_found");

      const moduleCopy = await repo.duplicateItem("module", m);
      const copies = (await repo.modulesOf([course.id], { includeHidden: true })).filter((x) => x.title.endsWith("(copy)") || x.parent_id === moduleCopy);
      expect(copies.find((x) => x.id === moduleCopy)).toMatchObject({ title: "Module (copy)", state: "hidden", position: 2, parent_id: null });
      const copiedWeek = copies.find((x) => x.parent_id === moduleCopy);
      expect(copiedWeek).toMatchObject({ title: "Week", state: "hidden" });
      const copiedLessons = (await repo.lessonsOf([course.id], { includeHidden: true })).filter((l) => l.module_id === moduleCopy || l.module_id === copiedWeek!.id);
      expect(copiedLessons.map((l) => l.title).sort()).toEqual(["First", "First (copy)", "Nested", "Second"].sort());
      expect(copiedLessons.every((l) => l.state === "hidden")).toBe(true);

      // Reorder: exactly the current children, no duplicates.
      const children = (await repo.lessonsOf([course.id], { includeHidden: true })).filter((l) => l.module_id === m).map((l) => l.id);
      expect(children.sort()).toEqual([l1, l2, lessonCopy].sort());
      await repo.reorderChildren({ courseId: course.id, kind: "lesson", parentId: m, ids: [lessonCopy, l2, l1] });
      const order = (await repo.lessonsOf([course.id], { includeHidden: true })).filter((l) => l.module_id === m).sort((x, y) => x.position - y.position).map((l) => l.id);
      expect(order).toEqual([lessonCopy, l2, l1]);
      await expect(repo.reorderChildren({ courseId: course.id, kind: "lesson", parentId: m, ids: [l1, l2] })).rejects.toThrow("stale_order");
      await expect(repo.reorderChildren({ courseId: course.id, kind: "lesson", parentId: m, ids: [l1, l1, l2] })).rejects.toThrow("stale_order");
      const tops = (await repo.modulesOf([course.id], { includeHidden: true })).filter((x) => x.parent_id === null).map((x) => x.id);
      await repo.reorderChildren({ courseId: course.id, kind: "module", parentId: null, ids: [...tops].reverse() });
      const reordered = (await repo.modulesOf([course.id], { includeHidden: true })).filter((x) => x.parent_id === null).sort((x, y) => x.position - y.position).map((x) => x.id);
      expect(reordered).toEqual([...tops].reverse());
    });

    it("records and clears the library image of a course, its banner, a module and a lesson", async () => {
      const course = newCourse("images");
      await ctx.seed.courses([course]);
      const repo = ctx.courses();
      const mod = await repo.addModule({ course_id: course.id, title: "M", position: 1, state: "hidden", source: "hub" });
      const les = await repo.addLesson({ course_id: course.id, module_id: mod, title: "L", position: 1, state: "open", source: "hub" });
      const asset = await ctx.seed.mediaAsset();

      for (const [kind, id] of [["course", course.id], ["hero", course.id], ["module", mod], ["lesson", les]] as const) {
        expect(await repo.imageOf(kind, id)).toMatchObject({ assetId: null });
        await repo.setImage(kind, id, { asset, source: `https://example.com/${kind}.png` });
        expect((await repo.imageOf(kind, id))?.assetId).toBe(asset);
      }
      const row = await repo.courseById(course.id);
      expect(row).toMatchObject({ thumbnail_asset_id: asset, thumbnail_source: "https://example.com/course.png", hero_asset_id: asset, hero_source: "https://example.com/hero.png" });
      expect(await repo.imageOf("module", mod)).toEqual({ assetId: asset, state: "hidden" });
      expect(await repo.imageOf("lesson", les)).toEqual({ assetId: asset, state: "open" });
      expect(await repo.imageOf("course", course.id)).toEqual({ assetId: asset, state: null });

      await repo.setImage("lesson", les, { asset: null, source: null });
      expect(await repo.imageOf("lesson", les)).toEqual({ assetId: null, state: "open" });
      expect(await repo.lessonById(les)).toMatchObject({ thumbnail_asset_id: null, thumbnail_source: null });
      expect(await repo.imageOf("course", newCourseId("crs"))).toBeNull();
      expect(await repo.imageOf("module", newCourseId("mod"))).toBeNull();
      expect(await repo.imageOf("lesson", newCourseId("les"))).toBeNull();
    });

    it("saves a lesson's download once per source key, lists the downloads of several lessons and deletes one", async () => {
      const course = newCourse("filesave");
      await ctx.seed.courses([course]);
      const repo = ctx.courses();
      const l1 = lessonRow({ id: newCourseId("les"), course_id: course.id, title: "L1" });
      const l2 = lessonRow({ id: newCourseId("les"), course_id: course.id, title: "L2" });
      await ctx.seed.lessons([l1, l2]);
      const key = ctx.unique("file");

      await repo.saveLessonFile({ lesson_id: l1.id, source_key: key, filename: "a.pdf", storage_path: "p/a.pdf", position: 1, size_bytes: 10, content_type: "application/pdf" });
      await repo.saveLessonFile({ lesson_id: l1.id, source_key: key, filename: "a-v2.pdf", storage_path: "p/a-v2.pdf", position: 2, size_bytes: 20, content_type: "application/pdf" });
      await repo.saveLessonFile({ lesson_id: l2.id, source_key: ctx.unique("file"), filename: "b.pdf", storage_path: "p/b.pdf" });
      const first = await repo.lessonFiles(l1.id);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ filename: "a-v2.pdf", position: 2, size_bytes: 20, storage_path: "p/a-v2.pdf", source_key: key });
      expect(first[0].id).toMatch(/^file_/);

      const both = await repo.filesOfLessons([l1.id, l2.id]);
      expect(both.map((f) => f.filename).sort()).toEqual(["a-v2.pdf", "b.pdf"]);
      expect(await repo.filesOfLessons([])).toEqual([]);

      await repo.deleteLessonFile(first[0].id);
      expect(await repo.lessonFiles(l1.id)).toEqual([]);
      expect(await repo.lessonFiles(l2.id)).toHaveLength(1);
    });

    it("creates videos, finds them by source key, and updates them by id or by Mux asset", async () => {
      const repo = ctx.courses();
      const k1 = ctx.unique("media");
      const k2 = ctx.unique("media");
      const id1 = await repo.createVideo({ source_kind: "kajabi", source_key: k1, status: "preparing", quality: "plus", duration_seconds: 61, has_burned_in_captions: true });
      const id2 = await repo.createVideo({ source_kind: "kajabi", source_key: k2 });
      await ctx.seed.forget({ videos: [id1, id2] });
      const video = async (id: string) => (await repo.videosByIds([id]))[0] ?? null;
      expect(await video(id1)).toMatchObject({ source_key: k1, status: "preparing", quality: "plus", has_burned_in_captions: true, mux_asset_id: null });
      expect(Number((await video(id1))!.duration_seconds)).toBe(61);
      expect((await repo.videosBySourceKeys("kajabi", [k1, k2, ctx.unique("none")])).map((v) => v.id).sort(compareText)).toEqual([id1, id2].sort(compareText));
      expect(await repo.videosBySourceKeys("upload", [k1])).toEqual([]);
      expect(await repo.videosBySourceKeys("kajabi", [])).toEqual([]);

      const asset = ctx.unique("asset");
      await repo.updateVideo(id1, { mux_asset_id: asset, source_fingerprint: "fp" });
      expect(await video(id1)).toMatchObject({ mux_asset_id: asset, source_fingerprint: "fp", status: "preparing" });
      expect((await repo.preparingVideos()).filter((v) => [id1, id2].includes(v.id))).toEqual([{ id: id1, mux_asset_id: asset }]);

      expect(await repo.updateVideosByAsset(ctx.unique("unknown-asset"), { status: "ready" })).toBe(0);
      expect(await repo.updateVideosByAsset(asset, { status: "ready", mux_playback_id: "pb", duration_seconds: 62 })).toBe(1);
      expect(await video(id1)).toMatchObject({ status: "ready", mux_playback_id: "pb" });
      expect((await repo.preparingVideos()).some((v) => v.id === id1)).toBe(false);
    });

    it("writes a member's progress without disturbing what is already there", async () => {
      const [m1, m2] = await ctx.members();
      const course = newCourse("progress-writes");
      await ctx.seed.courses([course]);
      const lessons = ["a", "b", "c"].map((t) => lessonRow({ id: newCourseId("les"), course_id: course.id, title: t }));
      await ctx.seed.lessons(lessons);
      const [a, b, c] = lessons;
      const progress = ctx.progress();

      // Completing creates the row; moving the playhead keeps the completion; completing again keeps the position.
      await progress.setCompletion(m1, a.id, T(1));
      expect(await progress.lessonPosition(m1, a.id)).toBe(0);
      await progress.savePosition(m1, a.id, 42.5);
      expect(await progress.lessonPosition(m1, a.id)).toBe(42.5);
      expect([...(await progress.completedLessonIds(m1, [a.id]))]).toEqual([a.id]);
      await progress.setCompletion(m1, a.id, null);
      expect((await progress.completedLessonIds(m1, [a.id])).size).toBe(0);
      expect(await progress.lessonPosition(m1, a.id)).toBe(42.5);
      await progress.setCompletion(m1, a.id, T(2));

      // Position first creates an uncompleted row.
      await progress.savePosition(m2, b.id, 7);
      expect((await progress.completedLessonIds(m2, [b.id])).size).toBe(0);
      expect(await progress.partlyWatched(m2, 5)).toEqual([{ lesson_id: b.id, last_position_seconds: 7 }]);

      // Insert-if-absent never touches a row that exists.
      await progress.insertProgressIfAbsent([
        { member_id: m1, lesson_id: a.id, completed_at: T(5), last_position_seconds: 0, imported_from: "kajabi" },
        { member_id: m1, lesson_id: c.id, completed_at: T(3), last_position_seconds: 0, imported_from: "kajabi" },
        { member_id: m2, lesson_id: b.id, completed_at: T(4), last_position_seconds: 0, imported_from: "kajabi" },
      ]);
      await progress.insertProgressIfAbsent([]);
      const rows = await progress.progressOfLessons(ids(lessons));
      expect(rows.map((r) => `${r.member_id}|${r.lesson_id}`)).toEqual([`${m1}|${a.id}`, `${m1}|${c.id}`, `${m2}|${b.id}`].sort());
      const byKey = new Map(rows.map((r) => [`${r.member_id}|${r.lesson_id}`, r]));
      expect(byKey.get(`${m1}|${a.id}`)).toMatchObject({ imported_from: null, last_position_seconds: 42.5 });
      expect(instant(byKey.get(`${m1}|${a.id}`)!.completed_at)).toBe(T(2));
      expect(byKey.get(`${m1}|${c.id}`)).toMatchObject({ imported_from: "kajabi" });
      expect(byKey.get(`${m2}|${b.id}`)).toMatchObject({ completed_at: null, last_position_seconds: 7, imported_from: null });
      expect(await progress.progressOfLessons([])).toEqual([]);

      await progress.clearProgress(m1, a.id);
      expect(await progress.lessonPosition(m1, a.id)).toBeNull();
      expect(await progress.lessonPosition(m1, c.id)).toBe(0);
    });

    it("saves watch segments once per client id, reads what was watched since a time, and clears a member's", async () => {
      const [m1, m2] = await ctx.members();
      const course = newCourse("segments");
      await ctx.seed.courses([course]);
      const v1 = videoRow({ id: randomUUID(), source_key: ctx.unique("media") });
      const v2 = videoRow({ id: randomUUID(), source_key: ctx.unique("media") });
      await ctx.seed.videos([v1, v2]);
      const progress = ctx.progress();
      const session = randomUUID();
      const clientIds = new Map<string, string>();
      const cid = (label: string) => clientIds.get(label) ?? (clientIds.set(label, randomUUID()), clientIds.get(label)!);
      const seg = (member: string, video: string, id: string, start: number, end: number, startedAt: string) => ({
        client_segment_id: cid(id),
        member_id: member,
        video_id: video,
        session_id: session,
        start_seconds: start,
        end_seconds: end,
        playback_rate: 1.5,
        captions_language: "en",
        visible: true,
        started_at: startedAt,
      });

      expect(await progress.saveSegments([seg(m1, v1.id, "s1", 0, 30, T(1)), seg(m1, v1.id, "s2", 30, 90, T(3))])).toBe(2);
      // A resend is skipped; only the new one counts.
      expect(await progress.saveSegments([seg(m1, v1.id, "s2", 30, 90, T(3)), seg(m1, v1.id, "s3", 90, 100, T(4))])).toBe(1);
      expect(await progress.saveSegments([])).toBe(0);
      // The same client id from another member is another segment.
      expect(await progress.saveSegments([seg(m2, v1.id, "s1", 5, 15, T(2)), seg(m1, v2.id, "x1", 0, 10, T(2))])).toBe(2);
      // A view marker: one per session, kind 'viewed'.
      const marker = { client_segment_id: session, member_id: m1, video_id: v1.id, session_id: session, kind: "viewed", start_seconds: 0, end_seconds: 0, user_agent: "Test Agent" };
      expect(await progress.saveSegments([marker])).toBe(1);
      expect(await progress.saveSegments([marker])).toBe(0);

      expect(await progress.watchedSince(m1, v1.id, T(2))).toEqual([
        { start_seconds: 30, end_seconds: 90, started_at: expect.any(String) },
        { start_seconds: 90, end_seconds: 100, started_at: expect.any(String) },
      ]);
      expect(await progress.watchedSince(m1, v1.id, T(4))).toHaveLength(1);
      expect(await progress.watchedSince(m1, v1.id, "2098-01-01T00:00:00.000Z")).toEqual([]);
      expect(await progress.watchedSince(m2, v2.id, T(1))).toEqual([]);

      const all = await progress.segmentsOfVideos([v1.id, v2.id]);
      expect(all).toHaveLength(6);
      expect(all.filter((s) => s.kind === "viewed")).toEqual([expect.objectContaining({ member_id: m1, video_id: v1.id, user_agent: "Test Agent", client_segment_id: session })]);
      expect(all.find((s) => s.client_segment_id === cid("s3"))).toMatchObject({ playback_rate: 1.5, captions_language: "en", visible: true, kind: "watched" });
      expect(ids(all)).toEqual(ids(all).slice().sort(compareText));
      expect(await progress.segmentsOfVideos([])).toEqual([]);

      expect(await progress.clearSegments(m1, v1.id)).toBe(4);
      expect(await progress.clearSegments(m1, v1.id)).toBe(0);
      expect((await progress.segmentsOfVideos([v1.id, v2.id])).map((s) => `${s.member_id}|${s.video_id}`).sort()).toEqual([`${m2}|${v1.id}`, `${m1}|${v2.id}`].sort());

      // Past one read page.
      const many = Array.from({ length: 1005 }, (_, i) => seg(m2, v2.id, `bulk-${i}`, i, i + 1, T(1)));
      expect(await progress.saveSegments(many)).toBe(1005);
      expect(await progress.segmentsOfVideos([v2.id])).toHaveLength(1006);
    });

    it("finds videos by id", async () => {
      const repo = ctx.courses();
      const v1 = videoRow({ id: randomUUID(), source_key: ctx.unique("media"), status: "ready", mux_playback_id: "pb-1" });
      const v2 = videoRow({ id: randomUUID(), source_key: ctx.unique("media") });
      await ctx.seed.videos([v1, v2]);
      expect((await repo.videosByIds([v1.id, v2.id, randomUUID()])).map((v) => v.id).sort(compareText)).toEqual([v1.id, v2.id].sort(compareText));
      expect(await repo.videosByIds([v1.id])).toEqual([expect.objectContaining({ mux_playback_id: "pb-1", status: "ready" })]);
      expect(await repo.videosByIds([])).toEqual([]);
    });

    it("reads staff grants, upserts the derived access on (member, course) and removes it for some members", async () => {
      const [m1, m2] = await ctx.members();
      const c1 = newCourse("derive-1");
      const c2 = newCourse("derive-2");
      await ctx.seed.courses([c1, c2]);
      const progress = ctx.progress();
      await ctx.seed.grants([grantRow({ id: randomUUID(), member_id: m1, course_id: c1.id, starts_at: T(1), ends_at: T(4), reason: "comp" }), grantRow({ id: randomUUID(), member_id: m2, course_id: c2.id })]);

      const grants = await progress.grantsOfCourses([c1.id]);
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({ member_id: m1, course_id: c1.id, reason: "comp" });
      expect((await progress.grantsOfCourses([c1.id, c2.id])).map((g) => g.course_id)).toEqual([c1.id, c2.id].sort(compareText));
      expect(await progress.grantsOfCourses([])).toEqual([]);

      await progress.upsertAccess([accessRow({ member_id: m1, course_id: c1.id, starts_at: T(1), ends_at: T(4), origin: "grant" }), accessRow({ member_id: m2, course_id: c1.id, starts_at: T(2) })]);
      await progress.upsertAccess([accessRow({ member_id: m1, course_id: c1.id, starts_at: T(1), ends_at: null, origin: "purchase" })]);
      const rows = await progress.accessOfCourses([c1.id]);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.member_id === m1)).toMatchObject({ ends_at: null, origin: "purchase" });
      await progress.upsertAccess([]);

      await progress.removeAccess(c1.id, [m1]);
      expect((await progress.accessOfCourses([c1.id])).map((r) => r.member_id)).toEqual([m2]);
      await progress.removeAccess(c1.id, []);
      expect(await progress.accessOfCourses([c1.id])).toHaveLength(1);
    });
  });
}
