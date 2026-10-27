import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";
import { loadContinueWatching } from "@/lib/courses/member";
import type { SupabaseClient } from "@supabase/supabase-js";

const NOW = new Date("2026-11-20T12:00:00Z");
const scope = { memberId: "mbr_AAAAAAAAAAA1", isAdminActing: false, now: NOW };

const course = { id: "c1", slug: "memoir", title: "Memoir Basics", description: null, thumbnail_url: "https://img.example.test/c.png" };
const lessons = [
  { id: "l1", course_id: "c1", module_id: null, title: "Voice", position: 1, state: "open", duration_seconds: 60, thumbnail_url: null, excerpt: null },
  { id: "l2", course_id: "c1", module_id: null, title: "Scenes", position: 2, state: "open", duration_seconds: 60, thumbnail_url: "https://img.example.test/l2.png", excerpt: null },
];

function client(over: FakeTables = {}) {
  const tables: FakeTables = {
    course_access: { data: [{ course_id: "c1", starts_at: "2026-01-01T00:00:00Z", ends_at: null }] },
    courses: { data: [course] },
    course_modules: { data: [] },
    course_lessons: (q) => ({ data: q.calls.some((c) => c.method === "in" && c.args[0] === "id") ? lessons.filter((l) => l.id === "l2") : lessons }),
    lesson_progress: (q) =>
      q.calls.some((c) => c.method === "gt")
        ? { data: [{ lesson_id: "l2", last_position_seconds: 90 }] }
        : { data: [{ lesson_id: "l1" }] },
    ...over,
  };
  return createFakeSupabase(tables) as unknown as SupabaseClient;
}

describe("loadContinueWatching", () => {
  it("resumes the half-watched lesson with a link to it", async () => {
    const result = await loadContinueWatching(client(), scope);
    expect(result).toMatchObject({ href: "/courses/memoir/lessons/l2", positionSeconds: 90, lesson: { title: "Scenes" }, progress: { completed: 1, available: 2 } });
  });

  it("falls back to the next open lesson of a started course", async () => {
    const result = await loadContinueWatching(
      client({ lesson_progress: (q) => (q.calls.some((c) => c.method === "gt") ? { data: [] } : { data: [{ lesson_id: "l1" }] }) }),
      scope
    );
    expect(result).toMatchObject({ href: "/courses/memoir/lessons/l2", positionSeconds: 0 });
  });

  it("offers nothing when nothing is started", async () => {
    expect(await loadContinueWatching(client({ lesson_progress: { data: [] } }), scope)).toBeNull();
  });

  it("offers nothing once access has ended", async () => {
    const ended = { course_access: { data: [{ course_id: "c1", starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" }] } };
    expect(await loadContinueWatching(client(ended), scope)).toBeNull();
  });

  it("offers nothing without access, or to staff acting as themselves", async () => {
    expect(await loadContinueWatching(client({ course_access: { data: [] } }), scope)).toBeNull();
    expect(await loadContinueWatching(client(), { ...scope, isAdminActing: true })).toBeNull();
  });

  it("throws on a database error", async () => {
    await expect(loadContinueWatching(client({ lesson_progress: { error: { message: "boom" } } }), scope)).rejects.toThrow(/lesson_progress/);
  });
});
