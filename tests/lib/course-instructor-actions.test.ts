import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { MAX_COURSE_INSTRUCTORS } from "@/lib/courses/instructors";

const state = vi.hoisted(() => ({ admin: true, failSet: false }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/analytics/server", () => ({ withAction: (_name: string, run: () => unknown) => run() }));
vi.mock("@/lib/admin-auth", () => ({
  requireActionPermission: async () => (state.admin ? { ok: true, user: { id: "u-admin" }, supabase: {} } : { ok: false, error: "Not authorized" }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

let data = new InMemoryDataset();
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return {
    ...actual,
    createRepos: () => {
      const repos = actual.createInMemoryRepos(data);
      if (state.failSet) repos.courseInstructors.set = async () => Promise.reject(new Error("db down"));
      return repos;
    },
  };
});

import { addInstructorsToAllCourses, saveCourseInstructorList } from "@/app/(admin)/admin/courses/instructor-actions";

const C1 = "crs_AAAAAAAAAAA1";
const C2 = "crs_AAAAAAAAAAA2";
const L1 = "les_AAAAAAAAAAA1";
const L2 = "les_AAAAAAAAAAA2";
const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const SAM = "mbr_AAAAAAAAAAA3";

const repos = () => createInMemoryRepos(data);
const flag = async (id: string) => (await repos().courseComments.byId(id))!.isInstructorReply;

async function seedComments() {
  const question = await repos().courseComments.create({ lessonId: L1, memberId: ADA, parentId: null, body: "Question", isInstructorReply: false });
  const bea = await repos().courseComments.create({ lessonId: L1, memberId: BEA, parentId: question.id, body: "Bea answers", isInstructorReply: false });
  const sam = await repos().courseComments.create({ lessonId: L1, memberId: SAM, parentId: question.id, body: "Staff replies", isInstructorReply: true });
  const other = await repos().courseComments.create({ lessonId: L2, memberId: BEA, parentId: null, body: "On another course", isInstructorReply: false });
  return { bea, sam, other };
}

beforeEach(() => {
  data = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example" },
      { id: BEA, name: "Bea Example" },
      { id: SAM, name: "Sam Staff" },
    ],
    courses: [
      { id: C1, slug: "one", title: "One" } as never,
      { id: C2, slug: "two", title: "Two" } as never,
    ],
    courseLessons: [
      { id: L1, course_id: C1, title: "Lesson one" } as never,
      { id: L2, course_id: C2, title: "Lesson two" } as never,
    ],
  });
  state.admin = true;
  state.failSet = false;
  revalidatePath.mockClear();
});

describe("saveCourseInstructorList", () => {
  it("refuses someone who may not manage courses, and writes nothing", async () => {
    state.admin = false;
    expect(await saveCourseInstructorList(C1, [BEA])).toEqual({ error: "Not authorized" });
    expect(data.courseInstructors).toEqual([]);
  });

  it("refuses ids that are not ours, too many instructors, and a course that is not there", async () => {
    expect(await saveCourseInstructorList("nope", [BEA])).toEqual({ error: "Course not found." });
    expect(await saveCourseInstructorList(C1, ["not-a-member"])).toEqual({ error: "Pick members from the list." });
    const tooMany = Array.from({ length: MAX_COURSE_INSTRUCTORS + 1 }, (_, i) => `mbr_AAAAAAAAAAA${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i]}`);
    expect((await saveCourseInstructorList(C1, tooMany)).error).toMatch(/up to 20 instructors/);
    expect(await saveCourseInstructorList("crs_ZZZZZZZZZZZZ", [BEA])).toEqual({ error: "Course not found." });
    expect(data.courseInstructors).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("saves the list and brings the badge on the course's existing comments in line, leaving other courses alone", async () => {
    const { bea, sam, other } = await seedComments();

    const result = await saveCourseInstructorList(C1, [BEA]);

    expect(result).toEqual({ added: 1, removed: 0, recomputed: 2 });
    expect(await repos().courseInstructors.forCourse(C1)).toEqual([BEA]);
    // Bea now carries the badge; the staff member's old badge (from when staff counted) is gone; another course is untouched.
    expect(await flag(bea.id)).toBe(true);
    expect(await flag(sam.id)).toBe(false);
    expect(await flag(other.id)).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${C1}`, "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/courses", "layout");
  });

  it("takes the badge away from an instructor who is removed, and saving the same list again changes nothing", async () => {
    const { bea } = await seedComments();
    await saveCourseInstructorList(C1, [BEA]);

    expect(await saveCourseInstructorList(C1, [BEA])).toEqual({ added: 0, removed: 0, recomputed: 0 });
    expect(await saveCourseInstructorList(C1, [])).toEqual({ added: 0, removed: 1, recomputed: 1 });
    expect(await flag(bea.id)).toBe(false);
  });

  it("answers with a plain message when the database refuses", async () => {
    state.failSet = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveCourseInstructorList(C1, [BEA])).toEqual({ error: "Couldn't save the instructors." });
    expect(log).toHaveBeenCalledWith("course instructors save failed:", "db down");
    log.mockRestore();
  });
});

describe("addInstructorsToAllCourses", () => {
  it("refuses someone who may not manage courses, and a course with no instructors to share", async () => {
    state.admin = false;
    expect(await addInstructorsToAllCourses(C1)).toEqual({ error: "Not authorized" });
    state.admin = true;
    expect(await addInstructorsToAllCourses("nope")).toEqual({ error: "Course not found." });
    expect(await addInstructorsToAllCourses(C1)).toEqual({ error: "Add an instructor to this course first." });
  });

  it("adds a course's instructors to every course, keeps the ones the others have, and updates their badges", async () => {
    const { other } = await seedComments();
    await saveCourseInstructorList(C1, [BEA]);
    await repos().courseInstructors.set(C2, [SAM]);

    const result = await addInstructorsToAllCourses(C1);

    expect(result).toEqual({ courses: 1, recomputed: 1 });
    expect([...(await repos().courseInstructors.forCourse(C2))].sort()).toEqual([BEA, SAM].sort());
    expect(await flag(other.id)).toBe(true);
    // A repeat adds nothing.
    expect(await addInstructorsToAllCourses(C1)).toEqual({ courses: 0, recomputed: 0 });
  });

  it("answers with a plain message when the database refuses", async () => {
    await repos().courseInstructors.set(C1, [BEA]);
    state.failSet = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await addInstructorsToAllCourses(C1)).toEqual({ error: "Couldn't add the instructors to every course." });
    log.mockRestore();
  });
});
