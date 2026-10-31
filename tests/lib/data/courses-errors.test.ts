import { describe, expect, it } from "vitest";
import { SupabaseCourseProgressRepository } from "@/lib/data/course-progress";
import { SupabaseCourseRepository } from "@/lib/data/courses";
import { failingDb } from "@/tests/helpers/failing-db";

describe("the course repositories on a database error", () => {
  const courses = new SupabaseCourseRepository(failingDb());
  const progress = new SupabaseCourseProgressRepository(failingDb());

  it.each([
    ["courseById", () => courses.courseById("crs_x")],
    ["courseBySlug", () => courses.courseBySlug("memoir")],
    ["courses", () => courses.courses()],
    ["courses by ids", () => courses.courses({ ids: ["crs_x"] })],
    ["modulesOf", () => courses.modulesOf(["crs_x"])],
    ["lessonsOf", () => courses.lessonsOf(["crs_x"])],
    ["lessonById", () => courses.lessonById("les_x")],
    ["lessonBody", () => courses.lessonBody("les_x")],
    ["openLessons", () => courses.openLessons(["les_x"])],
    ["lessonFiles", () => courses.lessonFiles("les_x")],
    ["lessonFile", () => courses.lessonFile("les_x", "file_x")],
    ["video", () => courses.video("v")],
    ["memberAccess", () => progress.memberAccess("mbr_x")],
    ["memberAccess for courses", () => progress.memberAccess("mbr_x", ["crs_x"])],
    ["accessOfCourses", () => progress.accessOfCourses(["crs_x"])],
    ["completedLessonIds", () => progress.completedLessonIds("mbr_x", ["les_x"])],
    ["partlyWatched", () => progress.partlyWatched("mbr_x", 5)],
    ["lessonPosition", () => progress.lessonPosition("mbr_x", "les_x")],
  ])("%s throws the database's message", async (_name, call) => {
    await expect(call()).rejects.toThrow("database is down");
  });
});
