import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { removalHash } from "@/lib/data/removal-hash";
import { CourseProgressError, importKajabiLessonProgress } from "@/lib/courses/progress-import";
import { accessRow, courseRow, lessonRow, progressRow } from "../helpers/course-fixtures";

/**
 * Kajabi per-lesson progress -> lesson_progress, in memory. What a member completed is theirs after Kajabi and after their
 * access ended, so any existing member matched by email (own or alias) gets the completion, with no course_access needed.
 * Insert-only; a removed person never comes back; an address with no member yet stays in Bronze for a later run.
 */

const COURSE = "crs_AAAAAAAAAAA1";
const K_COURSE = "kc-1";
const L1 = "les_AAAAAAAAAAA1";
const L2 = "les_AAAAAAAAAAA2";
const CURRENT = "mbr_AAAAAAAAAAA1";
const LAPSED = "mbr_AAAAAAAAAAA2";
const ALIASED = "mbr_AAAAAAAAAAA3";
const CANCELLED = "mbr_AAAAAAAAAAA4";
const TWIN_A = "mbr_AAAAAAAAAAA5";
const TWIN_B = "mbr_AAAAAAAAAAA6";
const ENDED = "mbr_AAAAAAAAAAA7";

type Bronze = InMemoryDataset["kajabiLessonProgress"][number];
const bronze = (email: string, lesson: string, over: Partial<Bronze> = {}): Bronze => ({
  course_kajabi_id: K_COURSE,
  email,
  kajabi_lesson_id: lesson,
  kajabi_contact_id: null,
  kajabi_member_id: null,
  completed: true,
  completed_at: "2026-01-05T17:00:00Z",
  percent: null,
  captured_at: "2026-11-01T10:00:00Z",
  deleted_at: null,
  ...over,
});

const world = (rows: Bronze[], extra: Partial<ConstructorParameters<typeof InMemoryDataset>[0]> = {}) => {
  const data = new InMemoryDataset({
    members: [
      { id: CURRENT, name: "Ada Example", email: "ada@example.test", status: "active" },
      { id: LAPSED, name: "Bo Example", email: "bo@example.test", status: "on_hiatus" },
      { id: ALIASED, name: "Cy Example", email: "cy@example.test", status: "active" },
      { id: CANCELLED, name: "Dee Example", email: "dee@example.test", status: "cancelled" },
      { id: TWIN_A, name: "Twin A", email: "twin@example.test", status: "active" },
      { id: TWIN_B, name: "Twin B", email: "TWIN@example.test", status: "active" },
      { id: ENDED, name: "Eve Example", email: "eve@example.test", status: "cancelled" },
    ],
    emailAliases: [{ id: "mea_AAAAAAAAAAA1", memberId: ALIASED, active: true, alias_email: "cy.old@example.test", canonical_email: "cy@example.test" }],
    courses: [courseRow({ id: COURSE, slug: "demo", title: "Demo", source: "kajabi", source_key: K_COURSE, is_draft: false })],
    courseLessons: [
      lessonRow({ id: L1, course_id: COURSE, title: "One", source: "kajabi", source_key: "kl-1" }),
      lessonRow({ id: L2, course_id: COURSE, title: "Two", source: "kajabi", source_key: "kl-2" }),
    ],
    // Only the current member and one whose access ended hold a course_access row; the others have none at all.
    courseAccess: [
      accessRow({ member_id: CURRENT, course_id: COURSE, starts_at: "2026-01-01T00:00:00Z" }),
      accessRow({ member_id: ENDED, course_id: COURSE, starts_at: "2025-01-01T00:00:00Z", ends_at: "2025-06-01T00:00:00Z" }),
    ],
    kajabiLessonProgress: rows,
    ...extra,
  });
  return { data, repos: createInMemoryRepos(data) };
};

const run = async (w: ReturnType<typeof world>, dryRun = false) => (await importKajabiLessonProgress(w.repos, { courseSlug: "demo", dryRun })).courses[0];
const rowsOf = (w: ReturnType<typeof world>, member: string) =>
  w.data.lessonProgress.filter((p) => p.member_id === member).sort((a, b) => a.lesson_id.localeCompare(b.lesson_id));

describe("importKajabiLessonProgress", () => {
  it("records a completion for every kind of existing member, with or without course access", async () => {
    const w = world([
      bronze("ada@example.test", "kl-1"),
      bronze("bo@example.test", "kl-1", { completed_at: "2026-01-06T10:00:00Z" }),
      bronze("cy.old@example.test", "kl-2"),
      bronze("dee@example.test", "kl-1"),
      bronze("eve@example.test", "kl-1"),
    ]);
    const summary = await run(w);
    expect(summary).toMatchObject({ completedInBronze: 5, inserted: 5, alreadyCompleted: 0, leftAlone: 0, orphanLessons: 0, students: { matched: 5, keptNoMember: 0, ambiguous: 0, removed: 0 } });
    expect(rowsOf(w, LAPSED)).toEqual([expect.objectContaining({ lesson_id: L1, completed_at: "2026-01-06T10:00:00.000Z", last_position_seconds: 0, imported_from: "kajabi" })]);
    expect(rowsOf(w, ALIASED).map((r) => r.lesson_id)).toEqual([L2]); // through the alias
    for (const m of [CURRENT, CANCELLED, ENDED]) expect(rowsOf(w, m)).toHaveLength(1);
    expect(w.data.courseAccess.filter((a) => a.member_id === LAPSED)).toEqual([]); // no access is granted by importing
  });

  it("counts a dry run and writes nothing", async () => {
    const w = world([bronze("bo@example.test", "kl-1"), bronze("ghost@example.test", "kl-1")]);
    expect(await run(w, true)).toMatchObject({ inserted: 1, students: { matched: 1, keptNoMember: 1 } });
    expect(w.data.lessonProgress).toHaveLength(0);
  });

  it("keeps an address with no member yet, counts it, and applies it on a later run once the member exists", async () => {
    const w = world([bronze("late@example.test", "kl-1"), bronze("late@example.test", "kl-2")]);
    expect(await run(w)).toMatchObject({ inserted: 0, students: { matched: 0, keptNoMember: 1 } });
    expect(w.data.members.some((m) => m.email === "late@example.test")).toBe(false); // never created
    expect(w.data.kajabiLessonProgress).toHaveLength(2); // still in Bronze

    w.data.members.push({ id: "mbr_AAAAAAAAAAA9", name: "Late Example", email: "late@example.test", status: "cancelled" } as never);
    expect(await run(w)).toMatchObject({ inserted: 2, students: { matched: 1, keptNoMember: 0 } });
    expect(rowsOf(w, "mbr_AAAAAAAAAAA9")).toHaveLength(2);
  });

  it("skips an email shared by two members instead of guessing", async () => {
    const w = world([bronze("twin@example.test", "kl-1")]);
    expect(await run(w)).toMatchObject({ inserted: 0, students: { matched: 0, ambiguous: 1 } });
    expect(rowsOf(w, TWIN_A)).toHaveLength(0);
    expect(rowsOf(w, TWIN_B)).toHaveLength(0);
  });

  it("brings nothing back for a removed person, even if a row is still in Bronze", async () => {
    const w = world([bronze("bo@example.test", "kl-1"), bronze("ada@example.test", "kl-1")], {
      removalTombstones: [{ kind: "email", key_hash: removalHash("bo@example.test"), created_at: "2027-01-01T00:00:00.000Z" }],
    });
    expect(await run(w)).toMatchObject({ inserted: 1, students: { matched: 1, removed: 1, keptNoMember: 0 } });
    expect(rowsOf(w, LAPSED)).toHaveLength(0);
    expect(rowsOf(w, CURRENT)).toHaveLength(1);
  });

  it("counts a lesson the Hub does not have as an orphan, without guessing", async () => {
    const w = world([bronze("bo@example.test", "kl-gone"), bronze("bo@example.test", "kl-1")]);
    expect(await run(w)).toMatchObject({ orphanLessons: 1, inserted: 1 });
  });

  it("never changes a row the member already has, and counts it", async () => {
    const w = world([bronze("bo@example.test", "kl-1"), bronze("bo@example.test", "kl-2"), bronze("ada@example.test", "kl-1")], {
      lessonProgress: [
        progressRow({ member_id: LAPSED, lesson_id: L1, completed_at: "2026-03-01T12:00:00Z", last_position_seconds: 55 }), // later than Kajabi's date
        progressRow({ member_id: LAPSED, lesson_id: L2, completed_at: null, last_position_seconds: 30 }),
      ],
    });
    const before = JSON.stringify(rowsOf(w, LAPSED));
    expect(await run(w)).toMatchObject({ inserted: 1, alreadyCompleted: 1, leftAlone: 1 });
    expect(JSON.stringify(rowsOf(w, LAPSED))).toBe(before);
  });

  it("keeps the earlier date when one member has two addresses in Bronze", async () => {
    const w = world([
      bronze("cy@example.test", "kl-1", { completed_at: "2026-02-01T00:00:00Z" }),
      bronze("cy.old@example.test", "kl-1", { completed_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(await run(w)).toMatchObject({ inserted: 1 });
    expect(rowsOf(w, ALIASED)).toEqual([expect.objectContaining({ completed_at: "2026-01-01T00:00:00.000Z" })]);
  });

  it("is idempotent and reprocessable: a second run inserts nothing, and a deleted row is restored", async () => {
    const w = world([bronze("bo@example.test", "kl-1"), bronze("ada@example.test", "kl-2")]);
    expect((await run(w)).inserted).toBe(2);
    const before = JSON.stringify(w.data.lessonProgress);
    const again = await run(w);
    expect(again).toMatchObject({ inserted: 0, alreadyCompleted: 2 });
    expect(JSON.stringify(w.data.lessonProgress)).toBe(before);
    w.data.lessonProgress.length = 0; // the Silver table is lost: Bronze rebuilds it
    expect((await run(w)).inserted).toBe(2);
  });

  it("reads past 1000 Bronze rows", async () => {
    const lessons = Array.from({ length: 1100 }, (_, i) => `kl-big-${i}`);
    const w = world(lessons.map((l) => bronze("bo@example.test", l)), {
      courseLessons: [lessonRow({ id: L1, course_id: COURSE, title: "One", source: "kajabi", source_key: "kl-1" }), ...lessons.map((l, i) => lessonRow({ id: `les_${String(i).padStart(11, "B")}`, course_id: COURSE, title: l, source: "kajabi", source_key: l }))],
    });
    expect(await run(w)).toMatchObject({ completedInBronze: 1100, inserted: 1100 });
    expect(rowsOf(w, LAPSED)).toHaveLength(1100);
  });

  it("ignores rows Bronze no longer lists as completed", async () => {
    const w = world([bronze("bo@example.test", "kl-1", { deleted_at: "2026-11-02T00:00:00Z" }), bronze("bo@example.test", "kl-2", { completed: false, completed_at: null })]);
    expect(await run(w)).toMatchObject({ completedInBronze: 0, inserted: 0 });
  });

  it("answers 404 for an unknown course", async () => {
    const w = world([]);
    await expect(importKajabiLessonProgress(w.repos, { courseSlug: "nope" })).rejects.toBeInstanceOf(CourseProgressError);
  });
});
