import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { accessRow, courseRow, lessonRow, videoRow } from "@/tests/helpers/course-fixtures";

/**
 * What the member's save paths answer when the database refuses a write: the mark-complete and
 * clear-progress actions and the watch route report a failure instead of pretending it saved.
 * The repositories are the in-memory twins with one method made to fail.
 */

const MEMBER = "mbr_AAAAAAAAAAA1";
const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const VIDEO = "00000000-0000-4000-8000-000000000001";
const SESSION = "00000000-0000-4000-a000-00000000c999";

let dataset = new InMemoryDataset();
let failing: { repo: "courses" | "courseProgress"; method: string } | null = null;
let isAdminActing = false;

vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => {
    const repos = createInMemoryRepos(dataset);
    if (failing) (repos[failing.repo] as unknown as Record<string, unknown>)[failing.method] = async () => Promise.reject(new Error("database is down"));
    return repos;
  },
}));
vi.mock("@/lib/courses/caller", () => ({
  getCoursesCaller: async () => ({ identity: { memberId: MEMBER, isSudo: false }, scope: { memberId: MEMBER, isAdminActing } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: async () => ({ ok: true }) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_name: string, run: () => Promise<unknown>) => run() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/courses/activity", () => ({ recordLessonCompleted: vi.fn(), recordLessonWatched: vi.fn() }));

import { clearMyLessonProgress, setLessonComplete } from "@/app/(member)/courses/actions";
import { POST } from "@/app/api/courses/watch/route";

const fail = (repo: "courses" | "courseProgress", method: string) => {
  failing = { repo, method };
};

beforeEach(() => {
  failing = null;
  isAdminActing = false;
  dataset = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "memoir", title: "Memoir" })],
    videos: [videoRow({ id: VIDEO, status: "ready" })],
    courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Voice", video_id: VIDEO, duration_seconds: 60 })],
    courseAccess: [accessRow({ member_id: MEMBER, course_id: COURSE, starts_at: "2020-01-01T00:00:00Z" })],
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("setLessonComplete", () => {
  it("saves the completion", async () => {
    expect(await setLessonComplete(LESSON, true)).toEqual({});
    expect(dataset.lessonProgress).toEqual([expect.objectContaining({ member_id: MEMBER, lesson_id: LESSON, completed_at: expect.any(String) })]);
  });

  it("says it couldn't save when the database refuses", async () => {
    fail("courseProgress", "setCompletion");
    expect(await setLessonComplete(LESSON, true)).toEqual({ error: "Couldn't save your progress" });
  });
});

describe("clearMyLessonProgress", () => {
  beforeEach(() => {
    isAdminActing = true;
  });

  it("clears the staff member's own segments and progress for the lesson", async () => {
    expect(await clearMyLessonProgress(LESSON)).toEqual({ segments: 0 });
  });

  it("says it couldn't clear when the segments or the progress row can't be removed", async () => {
    fail("courseProgress", "clearSegments");
    expect(await clearMyLessonProgress(LESSON)).toEqual({ error: "Couldn't clear your progress" });
    fail("courseProgress", "clearProgress");
    expect(await clearMyLessonProgress(LESSON)).toEqual({ error: "Couldn't clear your progress" });
  });
});

describe("POST /api/courses/watch", () => {
  const segment = { id: "00000000-0000-4000-8000-0000000000a1", start: 0, end: 30, rate: 1, captions: null, visible: true };
  const post = (body: Record<string, unknown>) =>
    POST(new NextRequest("http://localhost/api/courses/watch", { method: "POST", headers: { "Content-Type": "application/json", "user-agent": "Test Agent" }, body: JSON.stringify({ lessonId: LESSON, sessionId: SESSION, segments: [], ...body }) }));

  it("answers 500 when a view marker, a segment or the position can't be saved", async () => {
    fail("courseProgress", "saveSegments");
    expect((await post({ viewed: true })).status).toBe(500);
    expect((await post({ segments: [segment] })).status).toBe(500);
    fail("courseProgress", "savePosition");
    expect((await post({ position: 12 })).status).toBe(500);
  });

  it("saves the marker, the segments and the position when the database is up", async () => {
    const response = await post({ viewed: true, segments: [segment], position: 12 });
    expect(await response.json()).toEqual({ saved: 1 });
    expect(dataset.videoWatchSegments.map((s) => s.kind).sort()).toEqual(["viewed", "watched"]);
    expect(dataset.lessonProgress).toEqual([expect.objectContaining({ last_position_seconds: 12, completed_at: null })]);
  });
});

