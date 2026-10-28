import { randomUUID } from "node:crypto";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";
import type { Db } from "@/lib/data/db";
import type { Repos } from "@/lib/data/repos";
import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { ProgressRow } from "./product-progress-csv";

/**
 * Kajabi "Product Progress" report -> bronze.kajabi_product_progress (docs/COURSES.md). Bronze only:
 * nothing here writes lesson_progress, because a percentage cannot say which lessons were done.
 * Needs a service-role client (admins can read the table, not write it).
 */

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

export interface ProgressImportResult {
  /** Rows in the file, all valid (an invalid file is rejected before this runs). */
  imported: number;
  /** Rows that were new, changed or back after being removed; the rest were already identical. */
  written: number;
  unchanged: number;
  /** Rows of this course that the file no longer lists. */
  removed: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  /** The emails the admin uploaded that match no member, for showing back to them. Never logged. */
  unmatchedEmails: string[];
  importBatch: string;
}

/**
 * Splits uploaded emails by how they match members: by email (case-insensitive) or an active email
 * alias, never by name. "Ambiguous" is one email several members have.
 */
export async function matchEmailsToMembers(repos: Pick<Repos, "members" | "aliases">, emails: string[]) {
  const [members, aliases] = await Promise.all([repos.members.identities(), repos.aliases.emailAliases({ activeOnly: true })]);
  const aliasMap = buildAliasMap(aliases);
  const membersByEmail = new Map<string, number>();
  for (const m of members) {
    const key = m.email.trim().toLowerCase();
    membersByEmail.set(key, (membersByEmail.get(key) ?? 0) + 1);
  }
  const matched: string[] = [];
  const ambiguous: string[] = [];
  const unmatched: string[] = [];
  for (const email of emails) {
    const count = membersByEmail.get(resolveEmail(email, aliasMap)) ?? 0;
    (count === 1 ? matched : count > 1 ? ambiguous : unmatched).push(email);
  }
  return { matched, ambiguous, unmatched };
}

function sameAs(stored: Stored, row: ProgressRow): boolean {
  return (
    stored.deleted_at === null &&
    Number(stored.percent) === row.percent &&
    stored.logins === row.logins &&
    stored.started_on === row.startedOn &&
    stored.last_activity_on === row.lastActivityOn
  );
}

/**
 * Replaces the course's snapshot with these rows: new and changed rows are upserted on
 * (course, email), rows the file no longer lists are soft-deleted, identical rows are left alone,
 * so importing the same file twice changes nothing. Other courses are never touched. The caller
 * has already refused a file with invalid rows, so a half-read file cannot soft-delete anyone.
 */
export async function importProductProgress(
  db: Db,
  repos: Pick<Repos, "members" | "aliases">,
  input: { courseKajabiId: string; rows: ProgressRow[]; sourceFile: string | null },
): Promise<ProgressImportResult> {
  const { courseKajabiId, rows, sourceFile } = input;
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
  for (const batch of chunk(toWrite, WRITE_CHUNK)) {
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
  const gone = existing.filter((s) => s.deleted_at === null && !listed.has(s.email)).map((s) => s.email);
  for (const batch of chunk(gone, ID_CHUNK)) {
    const { error } = await table()
      .update({ deleted_at: now, import_batch: importBatch })
      .eq("course_kajabi_id", courseKajabiId)
      .in("email", batch);
    if (error) throw new Error(`Could not remove progress rows: ${error.message}`);
  }

  const match = await matchEmailsToMembers(repos, rows.map((r) => r.email));
  return {
    imported: rows.length,
    written: toWrite.length,
    unchanged: rows.length - toWrite.length,
    removed: gone.length,
    matched: match.matched.length,
    ambiguous: match.ambiguous.length,
    unmatched: match.unmatched.length,
    unmatchedEmails: match.unmatched,
    importBatch,
  };
}

export interface MemberProductProgress {
  percent: number;
  logins: number | null;
  startedOn: string | null;
  lastActivityOn: string | null;
  importedAt: string;
}

/**
 * What the last Kajabi report said about this member in this course (Kajabi course id), or null.
 * Looks under the member's email and any active email aliases that point at it. For the member-
 * confirmed catch-up step (docs/TODO.md, "Catch-up from imported Kajabi progress"); it is a hint to
 * show, never something to write into lesson_progress on its own. If the report lists several of
 * the member's addresses, the highest percentage wins.
 */
export async function memberProductProgress(
  db: Db,
  repos: Pick<Repos, "members" | "aliases">,
  memberId: string,
  courseKajabiId: string,
): Promise<MemberProductProgress | null> {
  const member = await repos.members.byId(memberId);
  if (!member) return null;
  const own = member.email.trim().toLowerCase();
  const aliases = await repos.aliases.emailAliases({ activeOnly: true });
  const emails = new Set([own]);
  for (const a of aliases) if (a.canonical_email.trim().toLowerCase() === own) emails.add(a.alias_email.trim().toLowerCase());

  const { data, error } = await db
    .schema("bronze")
    .from("kajabi_product_progress")
    .select("percent, logins, started_on, last_activity_on, imported_at")
    .eq("course_kajabi_id", courseKajabiId)
    .is("deleted_at", null)
    .in("email", [...emails])
    .order("percent", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read imported progress: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return {
    percent: Number(row.percent),
    logins: row.logins,
    startedOn: row.started_on,
    lastActivityOn: row.last_activity_on,
    importedAt: row.imported_at,
  };
}
