import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadContinueWatching } from "@/lib/courses/member";
import { accessRow, courseRow, lessonRow, progressRow } from "@/tests/helpers/course-fixtures";
import { createRepos } from "@/lib/data/repos";

let dataset = new InMemoryDataset();
let failProgressRead = false;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => {
    const repos = createInMemoryRepos(dataset);
    if (failProgressRead) repos.courseProgress.partlyWatched = async () => Promise.reject(new Error("boom"));
    return repos;
  },
}));

const NOW = new Date("2026-11-20T12:00:00Z");
const MEMBER = "mbr_AAAAAAAAAAA1";
const scope = { memberId: MEMBER, isAdminActing: false, now: NOW };
const client = {} as SupabaseClient;

const COURSE = "crs_AAAAAAAAAAA1";
const L1 = "les_AAAAAAAAAAA1";
const L2 = "les_AAAAAAAAAAA2";

function seed(over: Partial<ConstructorParameters<typeof InMemoryDataset>[0]> = {}) {
  dataset = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "memoir", title: "Memoir Basics", thumbnail_url: "https://img.example.test/c.png" })],
    courseLessons: [
      lessonRow({ id: L1, course_id: COURSE, title: "Voice", position: 1, duration_seconds: 60 }),
      lessonRow({ id: L2, course_id: COURSE, title: "Scenes", position: 2, duration_seconds: 60, thumbnail_url: "https://img.example.test/l2.png" }),
    ],
    courseAccess: [accessRow({ member_id: MEMBER, course_id: COURSE, starts_at: "2026-01-01T00:00:00Z" })],
    lessonProgress: [
      progressRow({ member_id: MEMBER, lesson_id: L1, completed_at: "2026-11-01T00:00:00Z" }),
      progressRow({ member_id: MEMBER, lesson_id: L2, last_position_seconds: 90 }),
    ],
    ...over,
  });
}

beforeEach(() => {
  failProgressRead = false;
  seed();
});

describe("loadContinueWatching", () => {
  it("resumes the half-watched lesson with a link to it", async () => {
    const result = await loadContinueWatching(createRepos(client), scope);
    expect(result).toMatchObject({ href: `/courses/memoir/lessons/${L2}`, positionSeconds: 90, lesson: { title: "Scenes" }, progress: { completed: 1, available: 2 } });
  });

  it("falls back to the next open lesson of a started course", async () => {
    seed({ lessonProgress: [progressRow({ member_id: MEMBER, lesson_id: L1, completed_at: "2026-11-01T00:00:00Z" })] });
    const result = await loadContinueWatching(createRepos(client), scope);
    expect(result).toMatchObject({ href: `/courses/memoir/lessons/${L2}`, positionSeconds: 0 });
  });

  it("offers nothing when nothing is started", async () => {
    seed({ lessonProgress: [] });
    expect(await loadContinueWatching(createRepos(client), scope)).toBeNull();
  });

  it("offers nothing once access has ended", async () => {
    seed({ courseAccess: [accessRow({ member_id: MEMBER, course_id: COURSE, starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" })] });
    expect(await loadContinueWatching(createRepos(client), scope)).toBeNull();
  });

  it("offers nothing without access, or to staff acting as themselves", async () => {
    seed({ courseAccess: [] });
    expect(await loadContinueWatching(createRepos(client), scope)).toBeNull();
    seed();
    expect(await loadContinueWatching(createRepos(client), { ...scope, isAdminActing: true })).toBeNull();
  });

  it("throws on a database error", async () => {
    failProgressRead = true;
    await expect(loadContinueWatching(createRepos(client), scope)).rejects.toThrow(/boom/);
  });
});
