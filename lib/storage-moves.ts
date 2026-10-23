import type { SupabaseClient } from "@supabase/supabase-js";

// Drains public.storage_path_moves: the queue the Tier 1 short id migration left behind for
// Storage objects whose path embeds an id that changed (docs/SHORT_IDS_PLAN.md). The migration
// already rewrote the path columns; this moves the files to match. Safe to re-run: a row is
// deleted only once the object is at its new path, and an object that is already there counts
// as done.

export interface MoveResult {
  moved: number;
  alreadyThere: number;
  failed: { bucket: string; oldPath: string; error: string }[];
}

export async function moveQueuedObjects(supabase: SupabaseClient): Promise<MoveResult> {
  const result: MoveResult = { moved: 0, alreadyThere: 0, failed: [] };
  const { data: rows, error } = await supabase.from("storage_path_moves").select("bucket, old_path, new_path");
  if (error) throw new Error(`reading storage_path_moves: ${error.message}`);

  for (const row of rows ?? []) {
    const bucket = supabase.storage.from(row.bucket);
    const { error: moveError } = await bucket.move(row.old_path, row.new_path);
    if (moveError) {
      const { data: there } = await bucket.exists(row.new_path);
      if (!there) {
        result.failed.push({ bucket: row.bucket, oldPath: row.old_path, error: moveError.message });
        continue;
      }
      result.alreadyThere++;
    } else {
      result.moved++;
    }
    const { error: deleteError } = await supabase
      .from("storage_path_moves")
      .delete()
      .eq("bucket", row.bucket)
      .eq("old_path", row.old_path);
    if (deleteError) result.failed.push({ bucket: row.bucket, oldPath: row.old_path, error: deleteError.message });
  }
  return result;
}
