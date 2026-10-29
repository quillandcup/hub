import { randomUUID } from "node:crypto";
import type { Db } from "../data/db";
import { chunk, fetchAllRows } from "../supabase/paginate";
import type { ProgressRow } from "./product-progress-csv";

// Relative imports only: scripts/kajabi-course-content.ts (--progress) uses this too, outside Next.

const WRITE_CHUNK = 500;
const ID_CHUNK = 100;

type Stored = {
  email: string;
  percent: number;
  logins: number | null;
  started_on: string | null;
  last_activity_on: string | null;
  deleted_at: string | null;
};

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
  const table = () => db.schema("bronze").from("kajabi_product_progress");
  const importBatch = randomUUID();
  const now = new Date().toISOString();

  const existing = await fetchAllRows<Stored>(
    (from, to) =>
      table()
        .select("email, percent, logins, started_on, last_activity_on, deleted_at")
        .eq("course_kajabi_id", courseKajabiId)
        .order("email")
        .range(from, to) as unknown as PromiseLike<{ data: Stored[] | null; error: { message: string } | null }>,
  );
  const storedByEmail = new Map(existing.map((s) => [s.email, s]));

  const toWrite = rows.filter((r) => {
    const stored = storedByEmail.get(r.email);
    return !stored || !sameAs(stored, r);
  });
  for (const batch of dryRun ? [] : chunk(toWrite, WRITE_CHUNK)) {
    const { error } = await table().upsert(
      batch.map((r) => ({
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
      { onConflict: "course_kajabi_id,email" },
    );
    if (error) throw new Error(`Could not save progress rows: ${error.message}`);
  }

  const listed = new Set(rows.map((r) => r.email));
  const gone = removeMissing ? existing.filter((s) => s.deleted_at === null && !listed.has(s.email)).map((s) => s.email) : [];
  for (const batch of dryRun ? [] : chunk(gone, ID_CHUNK)) {
    const { error } = await table()
      .update({ deleted_at: now, import_batch: importBatch })
      .eq("course_kajabi_id", courseKajabiId)
      .in("email", batch);
    if (error) throw new Error(`Could not remove progress rows: ${error.message}`);
  }

  return { written: toWrite.length, unchanged: rows.length - toWrite.length, removed: gone.length, importBatch };
}
