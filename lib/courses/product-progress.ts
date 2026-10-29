import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";
import type { Db } from "@/lib/data/db";
import type { Repos } from "@/lib/data/repos";
import { saveProductProgress } from "./product-progress-store";
import type { ProgressRow } from "./product-progress-csv";

/**
 * Kajabi "Product Progress" report -> bronze.kajabi_product_progress (docs/COURSES.md). Bronze only:
 * nothing here writes lesson_progress, because a percentage cannot say which lessons were done.
 * Needs a service-role client (admins can read the table, not write it).
 */

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

/** Saves the uploaded report as the course's snapshot (see `saveProductProgress`) and counts how its emails match members. */
export async function importProductProgress(
  db: Db,
  repos: Pick<Repos, "members" | "aliases">,
  input: { courseKajabiId: string; rows: ProgressRow[]; sourceFile: string | null },
): Promise<ProgressImportResult> {
  const { courseKajabiId, rows, sourceFile } = input;
  const saved = await saveProductProgress(db, { courseKajabiId, rows, sourceFile });
  const match = await matchEmailsToMembers(repos, rows.map((r) => r.email));
  return {
    imported: rows.length,
    written: saved.written,
    unchanged: saved.unchanged,
    removed: saved.removed,
    matched: match.matched.length,
    ambiguous: match.ambiguous.length,
    unmatched: match.unmatched.length,
    unmatchedEmails: match.unmatched,
    importBatch: saved.importBatch,
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
