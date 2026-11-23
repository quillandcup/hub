import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadDeletePreview } from "@/lib/courses/delete";
import { deleteBlockedReason } from "@/lib/courses/blocked-reasons";
import { accessRow, courseRow, lessonRow, moduleRow, progressRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const M1 = "mod_AAAAAAAAAAA1";
const L1 = "les_AAAAAAAAAAA1";
const MEMBER = "mbr_AAAAAAAAAAA1";

const repos = (over: { source?: string; isDraft?: boolean; withMember?: boolean } = {}) =>
  createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: COURSE, slug: "c", title: "C", source: over.source ?? "hub", source_key: over.source === "kajabi" ? "k" : null, is_draft: over.isDraft ?? true })],
      courseModules: [moduleRow({ id: M1, course_id: COURSE, title: "A" })],
      courseLessons: [lessonRow({ id: L1, course_id: COURSE, module_id: M1, title: "One" }), lessonRow({ id: "les_AAAAAAAAAAA2", course_id: COURSE, title: "Two" })],
      courseAccess: over.withMember ? [accessRow({ member_id: MEMBER, course_id: COURSE })] : [],
      lessonProgress: over.withMember ? [progressRow({ member_id: MEMBER, lesson_id: L1 })] : [],
    }),
  );

describe("loadDeletePreview", () => {
  it("counts what would go and what members have, changing nothing", async () => {
    const r = repos();
    expect(await loadDeletePreview(r, COURSE)).toEqual({ modules: 1, lessons: 2, source: "hub", isDraft: true, members: 0, activity: 0 });
    expect((await r.courses.courses()).length).toBe(1);
  });

  it("reports members' access and what they left", async () => {
    expect(await loadDeletePreview(repos({ withMember: true }), COURSE)).toMatchObject({ members: 1, activity: 1 });
  });

  it("has nothing to say about a course that isn't there", async () => {
    expect(await loadDeletePreview(repos(), "crs_AAAAAAAAAAA9")).toBeNull();
  });

  it("feeds the blocked reason: a draft Hub course nobody uses can go, an imported, published or used one can't", async () => {
    expect(deleteBlockedReason((await loadDeletePreview(repos(), COURSE))!)).toBeNull();
    expect(deleteBlockedReason((await loadDeletePreview(repos({ source: "kajabi" }), COURSE))!)).toMatch(/Kajabi/);
    expect(deleteBlockedReason((await loadDeletePreview(repos({ isDraft: false }), COURSE))!)).toMatch(/Unpublish/);
    expect(deleteBlockedReason((await loadDeletePreview(repos({ withMember: true }), COURSE))!)).toMatch(/access/);
  });
});
