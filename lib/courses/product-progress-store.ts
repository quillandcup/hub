import { randomUUID } from "node:crypto";
import type { Db } from "../data/db";
import { SupabaseKajabiCourseRepository, type StoredProductProgress as Stored } from "../data/kajabi-courses";
import type { ProgressRow } from "./product-progress-csv";

// Relative imports only: scripts/kajabi-course-content.ts (--progress) uses this too, outside Next.

function sameAs(stored: Stored, row: ProgressRow): boolean {
  return (
    stored.deleted_at === null &&
    Number(stored.percent) === row.percent &&
    stored.logins === row.logins &&
    stored.started_on === row.startedOn &&
    stored.last_activity_on === row.lastActivityOn
  );
}

export interface SaveProgressResult {
  written: number;
  unchanged: number;
  removed: number;
  importBatch: string;
}

/**
 * Replaces the course's snapshot with these rows: new and changed rows are upserted on
 * (course, email), rows the file no longer lists are soft-deleted (unless `removeMissing` is false, for a roster
 * known to be partial), identical rows are left alone, so saving the same rows twice changes nothing. Other
 * courses are never touched. `dryRun` reads and counts but writes nothing. The caller has already refused a
 * file with invalid rows, so a half-read file cannot soft-delete anyone.
 */
export async function saveProductProgress(
  db: Db,
  input: { courseKajabiId: string; rows: ProgressRow[]; sourceFile: string | null; dryRun?: boolean; removeMissing?: boolean },
): Promise<SaveProgressResult> {
  const { courseKajabiId, rows, sourceFile, dryRun = false, removeMissing = true } = input;
  const repo = new SupabaseKajabiCourseRepository(db);
  const importBatch = randomUUID();
  const now = new Date().toISOString();

  const existing = await repo.productProgress(courseKajabiId);
  const storedByEmail = new Map(existing.map((s) => [s.email, s]));

  const toWrite = rows.filter((r) => {
    const stored = storedByEmail.get(r.email);
    return !stored || !sameAs(stored, r);
  });
  if (!dryRun) {
    await repo.upsertProductProgress(
      toWrite.map((r) => ({
        course_kajabi_id: courseKajabiId,
        email: r.email,
        percent: r.percent,
        logins: r.logins,
        started_on: r.startedOn,
        last_activity_on: r.lastActivityOn,
        import_batch: importBatch,
        source_file: sourceFile,
        imported_at: now,
        deleted_at: null,
      })),
    );
  }

  const listed = new Set(rows.map((r) => r.email));
  const gone = removeMissing ? existing.filter((s) => s.deleted_at === null && !listed.has(s.email)).map((s) => s.email) : [];
  if (!dryRun) await repo.softDeleteProductProgress(courseKajabiId, gone, now, importBatch);

  return { written: toWrite.length, unchanged: rows.length - toWrite.length, removed: gone.length, importBatch };
}
