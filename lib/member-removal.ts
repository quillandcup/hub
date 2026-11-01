import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import { createRepos } from "@/lib/data/repos";

/**
 * Removing a member on their request: a dry run of what would happen, and the real thing. The database does the
 * work in one transaction (`remove_member_data`, per the choices in `member_data_handling`); this adds the parts
 * the database can't: their auth user and the files in storage. Service role only.
 *
 * Irreversible once it has run (docs/TODO.md, "Removal on request for records with a required member id"). The
 * caller checks the staff member's role, who is being removed and the typed confirmation.
 */

type Db = SupabaseClient<Database>;

export interface RemovalPreviewRow {
  table: string;
  column: string;
  action: string;
  why: string;
  count: number;
}

export interface RemovalPreview {
  /** Only the choices that touch at least one row, deletes first. */
  rows: RemovalPreviewRow[];
  /** Live books on their shelf: the ones staff ask the member about keeping. */
  liveBooks: number;
}

const ACTION_ORDER = ["delete", "ask", "null", "repoint", "keep"];

/** What a removal would do for one member: a count per decision in the catalog. Changes nothing. */
export async function previewMemberRemoval(db: Db, memberId: string): Promise<RemovalPreview> {
  const { data, error } = await db.rpc("member_data_report", { p_member_id: memberId });
  if (error) throw new Error(error.message);
  const rows = (data ?? [])
    .filter((r) => r.row_count > 0)
    .map((r) => ({ table: r.table_name, column: r.column_name, action: r.action, why: r.why, count: Number(r.row_count) }))
    .sort((a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action) || a.table.localeCompare(b.table));
  return { rows, liveBooks: await createRepos(db).books.countLive(memberId) };
}

const MEDIA_BUCKET = "media";
const FEEDBACK_BUCKET = "feedback-screenshots";

export type RemovalResult =
  | { ok: true; /** What did not finish after the database part had committed: the person must follow these up by hand. */ leftovers: string[] }
  | { ok: false; error: string };

/**
 * Runs the removal. The database part is all or nothing; when it fails nothing has changed. Once it has committed,
 * deleting the auth user and the stored files can still fail, and then the result says so (`leftovers`) rather than
 * pretending it all went through.
 */
export async function removeMemberOnRequest(db: Db, memberId: string, keepPublic: boolean): Promise<RemovalResult> {
  const { data, error } = await db.rpc("remove_member_data", { p_member_id: memberId, p_keep_public: keepPublic });
  if (error) return { ok: false, error: error.message };
  const result = data as { auth_user_id: string | null; media_paths: string[]; feedback_paths: string[] };

  const leftovers: string[] = [];

  if (result.auth_user_id) {
    const { error: userError } = await db.auth.admin.deleteUser(result.auth_user_id);
    if (userError) leftovers.push(`Their sign-in account was not deleted (${userError.message}). Delete it from Authentication in Supabase.`);
  }

  const files: [string, string[]][] = [
    [MEDIA_BUCKET, result.media_paths],
    [FEEDBACK_BUCKET, result.feedback_paths],
  ];
  for (const [bucket, paths] of files) {
    if (paths.length === 0) continue;
    const { error: removeError } = await db.storage.from(bucket).remove(paths);
    if (removeError) leftovers.push(`${paths.length} file(s) in the ${bucket} bucket were not deleted (${removeError.message}).`);
  }

  return { ok: true, leftovers };
}
