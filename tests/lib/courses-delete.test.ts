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
    expect(await loadDeletePreview(r, COURSE)).toEqual({ modules: 1, lessons: 2, source: "hub", isDraft: true, access: 0, grants: 0, progress: 0, comments: 0, chatVideos: 0 });
    expect((await r.courses.courses()).length).toBe(1);
  });

  it("reports members' access and what they left", async () => {
    expect(await loadDeletePreview(repos({ withMember: true }), COURSE)).toMatchObject({ access: 1, grants: 0, progress: 1 });
  });

  it("has nothing to say about a course that isn't there", async () => {
    expect(await loadDeletePreview(repos(), "crs_AAAAAAAAAAA9")).toBeNull();
  });

  it("feeds the blocked reason: a draft Hub course nobody uses can go, an imported, published or used one can't", async () => {
    expect(deleteBlockedReason((await loadDeletePreview(repos(), COURSE))!)).toBeNull();
    expect(deleteBlockedReason((await loadDeletePreview(repos({ source: "kajabi" }), COURSE))!)).toMatch(/Kajabi/);
    expect(deleteBlockedReason((await loadDeletePreview(repos({ isDraft: false }), COURSE))!)).toMatch(/Unpublish/);
    expect(deleteBlockedReason((await loadDeletePreview(repos({ withMember: true }), COURSE))!)).toMatch(/1 with access/);
  });
});

describe("deleteCourse in the in-memory repository: what was left on the lessons", () => {
  const withLeftovers = () => {
    const data = new InMemoryDataset({
      courses: [courseRow({ id: COURSE, slug: "c", title: "C", source: "hub", source_key: null, is_draft: true })],
      courseLessons: [lessonRow({ id: L1, course_id: COURSE, title: "One" })],
      lessonProgress: [progressRow({ member_id: MEMBER, lesson_id: L1 })],
      lessonComments: [
        { id: "cmnt_AAAAAAAAAAA1", lesson_id: L1, member_id: MEMBER, parent_id: null, body: "Test", is_staff_reply: false, created_at: "2026-01-01T00:00:00Z", edited_at: null, hidden_at: null, deleted_at: null, deleted_by: null, held_at: null, held_reason: null, handled_at: null, handled_by: null },
      ],
      chatMessageVideos: [{ id: "cmv_AAAAAAAAAAA1", message_id: "m1", lesson_id: L1, open_to_channel: false, start_seconds: null, created_at: "2026-01-01T00:00:00Z" }],
    });
    return { data, repos: createInMemoryRepos(data) };
  };

  it("counts each kind, and deletes the course with progress, comments and chat video links", async () => {
    const { data, repos: r } = withLeftovers();
    expect(await loadDeletePreview(r, COURSE)).toMatchObject({ access: 0, grants: 0, progress: 1, comments: 1, chatVideos: 1 });
    expect(deleteBlockedReason((await loadDeletePreview(r, COURSE))!)).toBeNull();
    await r.courses.deleteCourse(COURSE);
    expect(await r.courses.courseById(COURSE)).toBeNull();
    expect([data.lessonProgress.length, data.lessonComments.length, data.chatMessageVideos.length]).toEqual([0, 0, 0]);
  });

  it("still refuses while someone has access", async () => {
    const { data, repos: r } = withLeftovers();
    data.courseAccess.push(accessRow({ member_id: MEMBER, course_id: COURSE }));
    await expect(r.courses.deleteCourse(COURSE)).rejects.toThrow("has_members");
    expect(data.lessonComments.length).toBe(1);
  });
});
