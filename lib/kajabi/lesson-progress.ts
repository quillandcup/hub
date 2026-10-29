/**
 * Bronze save for the per-lesson progress captured by `courses:content --progress` (docs/COURSES.md,
 * "Importing Kajabi per-lesson progress"): `bronze.kajabi_lesson_progress`, one snapshot per (course, student).
 *
 * Relative imports only: the script that calls this runs outside Next.
 */

import type { Db } from "../data/db";
import { chunk, fetchAllRows } from "../supabase/paginate";
import type { LessonEntry } from "./progress-capture";

const WRITE_CHUNK = 500;
const DELETE_CHUNK = 100;

type Stored = {
  kajabi_lesson_id: string;
  kajabi_contact_id: string | null;
  kajabi_member_id: string | null;
  completed: boolean;
  completed_at: string | null;
  percent: number | string | null;
  deleted_at: string | null;
};

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
  const table = () => db.schema("bronze").from("kajabi_lesson_progress");
  const ids = { contactId, memberId };

  const existing = await fetchAllRows<Stored>(
    (from, to) =>
      table()
        .select("kajabi_lesson_id, kajabi_contact_id, kajabi_member_id, completed, completed_at, percent, deleted_at")
        .eq("course_kajabi_id", courseKajabiId)
        .eq("email", email)
        .order("kajabi_lesson_id")
        .range(from, to) as unknown as PromiseLike<{ data: Stored[] | null; error: { message: string } | null }>,
  );
  const storedById = new Map(existing.map((s) => [s.kajabi_lesson_id, s]));
  const toWrite = lessons.filter((l) => {
    const stored = storedById.get(l.kajabiLessonId);
    return !stored || !sameAs(stored, l, ids);
  });
  const listed = new Set(lessons.map((l) => l.kajabiLessonId));
  const gone = existing.filter((s) => s.deleted_at === null && !listed.has(s.kajabi_lesson_id)).map((s) => s.kajabi_lesson_id);

  if (!options.dryRun) {
    for (const batch of chunk(toWrite, WRITE_CHUNK)) {
      const { error } = await table().upsert(
        batch.map((l) => ({
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
        { onConflict: "course_kajabi_id,email,kajabi_lesson_id" },
      );
      if (error) throw new Error(`Could not save lesson progress: ${error.message}`);
    }
    for (const batch of chunk(gone, DELETE_CHUNK)) {
      const { error } = await table()
        .update({ deleted_at: capturedAt.toISOString() })
        .eq("course_kajabi_id", courseKajabiId)
        .eq("email", email)
        .in("kajabi_lesson_id", batch);
      if (error) throw new Error(`Could not remove lesson progress: ${error.message}`);
    }
  }
  return { written: toWrite.length, unchanged: lessons.length - toWrite.length, removed: gone.length };
}
