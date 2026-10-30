import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseKajabiCourseRepository } from "@/lib/data/kajabi-courses";

/** A client whose every query answers with a database error: the repository must throw it, not return an empty result. */
function failingDb(): Db {
  const answer = { data: null, error: { message: "database is down" }, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "in", "is", "or", "order", "range", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  const client = { from: () => chain, schema: () => client };
  return client as unknown as Db;
}

const course = { kajabi_id: "c1", title: "Course", raw_payload: {} };
const at = "2097-01-01T00:00:00Z";

describe("SupabaseKajabiCourseRepository on a database error", () => {
  const repo = new SupabaseKajabiCourseRepository(failingDb());

  it.each([
    ["liveCourses", () => repo.liveCourses()],
    ["liveCourse", () => repo.liveCourse("c1")],
    ["upsertCourses", () => repo.upsertCourses([course])],
    ["setCourseHero", () => repo.setCourseHero("c1", "https://example.com/h.png", at)],
    ["softDeleteCourses", () => repo.softDeleteCourses(["c1"], at)],
    ["liveModules", () => repo.liveModules("c1")],
    ["liveModules (all)", () => repo.liveModules()],
    ["liveModuleIds", () => repo.liveModuleIds("c1")],
    ["upsertModules", () => repo.upsertModules([{ kajabi_id: "m1", course_kajabi_id: "c1", title: "M", raw_payload: {} }])],
    ["softDeleteModules", () => repo.softDeleteModules(["m1"], at)],
    ["liveLessons", () => repo.liveLessons("c1")],
    ["liveLessonOutlines", () => repo.liveLessonOutlines("c1")],
    ["liveLessonOutlines (all)", () => repo.liveLessonOutlines()],
    ["liveLessonIds", () => repo.liveLessonIds("c1")],
    ["liveLesson", () => repo.liveLesson("c1", "l1")],
    ["contentState", () => repo.contentState("l1")],
    ["lessonTargets by course", () => repo.lessonTargets({ courseId: "c1" })],
    ["lessonTargets by lesson with drafts", () => repo.lessonTargets({ lessonId: "l1" }, { includeDrafts: true })],
    ["saveContent", () => repo.saveContent("l1", { body_html: null, thumbnail_url: null, video_media_id: null, video_source: null, content_hash: "h", content_fetched_at: at })],
    ["setVideoSource", () => repo.setVideoSource("l1", null)],
    ["upsertLessons", () => repo.upsertLessons([{ kajabi_id: "l1", course_kajabi_id: "c1", title: "L", raw_payload: {} }])],
    ["softDeleteLessons", () => repo.softDeleteLessons(["l1"], at)],
    ["liveFiles", () => repo.liveFiles(["l1"])],
    ["liveFileIds", () => repo.liveFileIds("l1")],
    ["upsertFiles", () => repo.upsertFiles([{ kajabi_id: "f1", lesson_kajabi_id: "l1", filename: "a.pdf", raw_payload: {} }])],
    ["setFileSourceUrl", () => repo.setFileSourceUrl("f1", null)],
    ["softDeleteFiles", () => repo.softDeleteFiles(["f1"], at)],
    ["liveOffers", () => repo.liveOffers(["c1"])],
    ["upsertOffers", () => repo.upsertOffers([{ course_kajabi_id: "c1", offer_kajabi_id: "o1" }])],
    ["softDeleteOffers", () => repo.softDeleteOffers("c1", ["o1"], at)],
    ["productProgress", () => repo.productProgress("c1")],
    ["bestProductProgress", () => repo.bestProductProgress("c1", ["ada@example.com"])],
    ["upsertProductProgress", () => repo.upsertProductProgress([{ course_kajabi_id: "c1", email: "ada@example.com", percent: 1, import_batch: "b" }])],
    ["softDeleteProductProgress", () => repo.softDeleteProductProgress("c1", ["ada@example.com"], at, "b")],
    ["lessonProgress", () => repo.lessonProgress("c1", "ada@example.com")],
    ["completedLessons", () => repo.completedLessons("c1")],
    ["upsertLessonProgress", () => repo.upsertLessonProgress([{ course_kajabi_id: "c1", email: "ada@example.com", kajabi_lesson_id: "l1", completed: true }])],
    ["softDeleteLessonProgress", () => repo.softDeleteLessonProgress("c1", "ada@example.com", ["l1"], at)],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });
});
