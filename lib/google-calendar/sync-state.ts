import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";

type Db = SupabaseClient<Database>;

/** A claim older than this is a sync that died without letting go (the route's maxDuration is 300s). */
export const CLAIM_STALE_MS = 5 * 60 * 1000;

function fail(what: string, error: { message: string }): never {
  throw new Error(`calendar_sync_state: ${what}: ${error.message}`);
}

/**
 * Take the right to sync this calendar. Returns `{ claimed: true, syncedThrough }` when no other
 * sync holds it; otherwise leaves a note ("run once more") for the one that does and returns
 * `{ claimed: false }`, so a burst of notifications becomes one running sync plus one rerun.
 * Each step is a single conditional UPDATE, so two callers can't both win.
 */
export async function claimCalendarSync(
  db: Db,
  calendarId: string,
  now: Date
): Promise<{ claimed: true; syncedThrough: Date | null } | { claimed: false }> {
  const { error: seedError } = await db
    .from("calendar_sync_state")
    .upsert({ calendar_id: calendarId }, { onConflict: "calendar_id", ignoreDuplicates: true });
  if (seedError) fail("create row", seedError);

  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  const { data, error } = await db
    .from("calendar_sync_state")
    .update({ running_since: now.toISOString(), rerun_requested: false })
    .eq("calendar_id", calendarId)
    .or(`running_since.is.null,running_since.lt.${staleBefore}`)
    .select("synced_through");
  if (error) fail("claim", error);
  if (data && data.length > 0) {
    const through = data[0].synced_through;
    return { claimed: true, syncedThrough: through ? new Date(through) : null };
  }

  const { error: noteError } = await db
    .from("calendar_sync_state")
    .update({ rerun_requested: true })
    .eq("calendar_id", calendarId);
  if (noteError) fail("request rerun", noteError);
  return { claimed: false };
}

/**
 * Let go of the claim, unless a notification asked for another run meanwhile. Returns true when
 * released, false when a rerun was requested (the claim is kept and the request cleared: run again).
 */
export async function releaseCalendarSync(db: Db, calendarId: string, now: Date): Promise<boolean> {
  const { data, error } = await db
    .from("calendar_sync_state")
    .update({ running_since: null })
    .eq("calendar_id", calendarId)
    .eq("rerun_requested", false)
    .select("calendar_id");
  if (error) fail("release", error);
  if (data && data.length > 0) return true;

  const { error: clearError } = await db
    .from("calendar_sync_state")
    .update({ rerun_requested: false, running_since: now.toISOString() })
    .eq("calendar_id", calendarId);
  if (clearError) fail("clear rerun", clearError);
  return false;
}

/** Let go after a failure, whatever was requested: the next notification starts from the old watermark. */
export async function abandonCalendarSync(db: Db, calendarId: string): Promise<void> {
  const { error } = await db.from("calendar_sync_state").update({ running_since: null }).eq("calendar_id", calendarId);
  if (error) console.error("[calendar-sync] could not release the claim:", error.message);
}

/** Record that everything the calendar changed before `startedAt` is in Bronze. */
export async function saveSyncedThrough(db: Db, calendarId: string, startedAt: Date): Promise<void> {
  const { error } = await db
    .from("calendar_sync_state")
    .upsert({ calendar_id: calendarId, synced_through: startedAt.toISOString() }, { onConflict: "calendar_id" });
  if (error) fail("save watermark", error);
}
