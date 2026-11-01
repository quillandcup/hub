/**
 * Bronze save for the per-lesson progress captured by `courses:content --progress` (docs/COURSES.md,
 * "Importing Kajabi per-lesson progress"): `bronze.kajabi_lesson_progress`, one snapshot per (course, student).
 *
 * Relative imports only: the script that calls this runs outside Next.
 */

import type { Db } from "../data/db";
import { SupabaseKajabiCourseRepository, type StoredLessonProgress as Stored } from "../data/kajabi-courses";
import type { LessonEntry } from "./progress-capture";

export interface LessonProgressSave {
  written: number;
  unchanged: number;
  removed: number;
}

const sameInstant = (a: string | null, b: string | null) => (a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime());

function sameAs(stored: Stored, lesson: LessonEntry, ids: { contactId: string | null; memberId: string | null }): boolean {
  return (
    stored.deleted_at === null &&
    stored.completed === lesson.completed &&
    sameInstant(stored.completed_at, lesson.completedAt) &&
    (stored.percent === null ? null : Number(stored.percent)) === lesson.percent &&
    stored.kajabi_contact_id === ids.contactId &&
    stored.kajabi_member_id === ids.memberId
  );
}

/**
 * Replaces one student's rows for a course with a fully fetched snapshot: new and changed lessons are upserted,
 * lessons the snapshot no longer lists are soft-deleted, an identical snapshot writes nothing. Only this
 * (course, email) is touched. Call it only after the student's report was read completely: a failed or partial
 * fetch must never reach here, or it would soft-delete lessons. `dryRun` counts without writing.
 */
export async function saveMemberLessonProgress(
  db: Db,
  input: {
    courseKajabiId: string;
    email: string;
    contactId: string | null;
    memberId: string | null;
    lessons: LessonEntry[];
    capturedAt: Date;
  },
  options: { dryRun?: boolean } = {},
): Promise<LessonProgressSave> {
  const { courseKajabiId, email, contactId, memberId, lessons, capturedAt } = input;
  const repo = new SupabaseKajabiCourseRepository(db);
  const ids = { contactId, memberId };

  const existing = await repo.lessonProgress(courseKajabiId, email);
  const storedById = new Map(existing.map((s) => [s.kajabi_lesson_id, s]));
  const toWrite = lessons.filter((l) => {
    const stored = storedById.get(l.kajabiLessonId);
    return !stored || !sameAs(stored, l, ids);
  });
  const listed = new Set(lessons.map((l) => l.kajabiLessonId));
  const gone = existing.filter((s) => s.deleted_at === null && !listed.has(s.kajabi_lesson_id)).map((s) => s.kajabi_lesson_id);

  if (!options.dryRun) {
    await repo.upsertLessonProgress(
      toWrite.map((l) => ({
        course_kajabi_id: courseKajabiId,
        email,
        kajabi_lesson_id: l.kajabiLessonId,
        kajabi_contact_id: contactId,
        kajabi_member_id: memberId,
        completed: l.completed,
        completed_at: l.completedAt,
        percent: l.percent,
        captured_at: capturedAt.toISOString(),
        deleted_at: null,
      })),
    );
    await repo.softDeleteLessonProgress(courseKajabiId, email, gone, capturedAt.toISOString());
  }
  return { written: toWrite.length, unchanged: lessons.length - toWrite.length, removed: gone.length };
}
