import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import { createRepos } from "@/lib/data/repos";
import { MILESTONE_PHOTO_BUCKET } from "@/lib/milestone-photos";
import { QUIZ_ANSWER_FILES_BUCKET } from "@/lib/courses/quiz-files";

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

/** One thing a removal does outside the catalog: sign-in rows, the auth user, stored files, cleared text, audit entries. */
export interface RemovalExtra {
  /** Stable key from `member_removal_extras`; the panel maps it to plain words. */
  item: string;
  action: "delete" | "clear" | "replace";
  /** The full count; `samples` is at most the first few. */
  count: number;
  /** Short labels naming them (never a path, token or note text). */
  samples: string[];
}

export interface RemovalPreview {
  /** Only the choices that touch at least one row, deletes first. */
  rows: RemovalPreviewRow[];
  /** Live books on their shelf: the ones staff ask the member about keeping. */
  liveBooks: number;
  /** Everything else the removal does, only the items that touch something. */
  extras: RemovalExtra[];
}

const ACTION_ORDER = ["delete", "ask", "null", "repoint", "keep"];

/** What a removal would do for one member: a count per decision in the catalog. Changes nothing. */
export async function previewMemberRemoval(db: Db, memberId: string): Promise<RemovalPreview> {
  const [report, extraReport] = await Promise.all([
    db.rpc("member_data_report", { p_member_id: memberId }),
    db.rpc("member_removal_extras", { p_member_id: memberId }),
  ]);
  if (report.error) throw new Error(report.error.message);
  if (extraReport.error) throw new Error(extraReport.error.message);
  const rows = (report.data ?? [])
    .filter((r) => r.row_count > 0)
    .map((r) => ({ table: r.table_name, column: r.column_name, action: r.action, why: r.why, count: Number(r.row_count) }))
    .sort((a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action) || a.table.localeCompare(b.table));
  const extras = (extraReport.data ?? [])
    .filter((r) => r.row_count > 0)
    .map((r) => ({ item: r.item, action: r.action as RemovalExtra["action"], count: Number(r.row_count), samples: r.samples ?? [] }));
  return { rows, extras, liveBooks: await createRepos(db).books.countLive(memberId) };
}

const MEDIA_BUCKET = "media";
const FEEDBACK_BUCKET = "feedback-screenshots";

/** Deletes every file in the member's own folder of a private bucket; a sentence for the person doing the removal when something stayed, else null. */
async function removeMemberFolder(db: Db, bucketName: string, what: string, memberId: string): Promise<string | null> {
  const bucket = db.storage.from(bucketName);
  // A folder lists at most `limit` files at a time; what was deleted is gone from the next listing.
  for (let round = 0; round < 20; round++) {
    const { data, error } = await bucket.list(memberId, { limit: 100 });
    if (error) return `Their ${what} could not be listed (${error.message}). Delete the ${memberId} folder in the ${bucketName} bucket.`;
    if (!data || data.length === 0) return null;
    const { error: removeError } = await bucket.remove(data.map((file) => `${memberId}/${file.name}`));
    if (removeError) return `${data.length} ${what} file(s) were not deleted (${removeError.message}).`;
  }
  return `Some ${what} may remain in the ${memberId} folder of the ${bucketName} bucket.`;
}

/**
 * Quiz answer files sit one level deeper (<member id>/<random>/<name>): list the member's folder, then each of its folders, and
 * delete what is in them. A sentence when something stayed, else null.
 */
async function removeQuizAnswerFiles(db: Db, memberId: string): Promise<string | null> {
  const bucket = db.storage.from(QUIZ_ANSWER_FILES_BUCKET);
  for (let round = 0; round < 20; round++) {
    const { data: folders, error } = await bucket.list(memberId, { limit: 100 });
    if (error) return `Their quiz answer files could not be listed (${error.message}). Delete the ${memberId} folder in the ${QUIZ_ANSWER_FILES_BUCKET} bucket.`;
    if (!folders || folders.length === 0) return null;
    const paths: string[] = [];
    for (const folder of folders) {
      const { data: files, error: listError } = await bucket.list(`${memberId}/${folder.name}`, { limit: 100 });
      if (listError) return `Their quiz answer files could not be listed (${listError.message}). Delete the ${memberId} folder in the ${QUIZ_ANSWER_FILES_BUCKET} bucket.`;
      for (const file of files ?? []) paths.push(`${memberId}/${folder.name}/${file.name}`);
    }
    if (paths.length === 0) return null;
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) return `${paths.length} quiz answer file(s) were not deleted (${removeError.message}).`;
  }
  return `Some quiz answer files may remain in the ${memberId} folder of the ${QUIZ_ANSWER_FILES_BUCKET} bucket.`;
}

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
    try {
      await createRepos(db).authUsers.delete(result.auth_user_id);
    } catch (userError) {
      leftovers.push(`Their sign-in account was not deleted (${userError instanceof Error ? userError.message : userError}). Delete it from Authentication in Supabase.`);
    }
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

  // Photos on milestones live under the member's own folder of a private bucket; their rows went with the member, so the folder goes too.
  const photoLeftover = await removeMemberFolder(db, MILESTONE_PHOTO_BUCKET, "milestone photos", memberId);
  if (photoLeftover) leftovers.push(photoLeftover);

  // What they wrote and uploaded in course quizzes: the rows went with the member, so their files go too.
  const quizLeftover = await removeQuizAnswerFiles(db, memberId);
  if (quizLeftover) leftovers.push(quizLeftover);

  return { ok: true, leftovers };
}
