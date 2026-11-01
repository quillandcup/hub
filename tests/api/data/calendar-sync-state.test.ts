import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCalendarSyncStateRepository } from "@/lib/data/calendar-sync-state";
import { defineCalendarSyncStateContract } from "@/tests/helpers/calendar-sync-state-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

// The claim protocol is single conditional UPDATEs, so its guarantees are the database's: run it against Postgres.
const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `sync-state-${Date.now()}`;
const calendars: string[] = [];
let counter = 0;

afterAll(async () => {
  if (calendars.length) {
    await db.from("calendar_sync_state").delete().in("calendar_id", calendars);
    await db.from("calendar_watch_channels").delete().in("calendar_id", calendars);
  }
});

defineCalendarSyncStateContract("SupabaseCalendarSyncStateRepository", () => ({
  repo: () => new SupabaseCalendarSyncStateRepository(db),
  calendarId: () => {
    const id = `${RUN}-${++counter}@example.test`;
    calendars.push(id);
    return id;
  },
  stored: async (calendarId) => (await db.from("calendar_sync_state").select("running_since, rerun_requested, synced_through").eq("calendar_id", calendarId).maybeSingle()).data,
}));
