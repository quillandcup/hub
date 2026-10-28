import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseEventRepository } from "@/lib/data/events";
import { defineEventContract, defineEventSyncContract } from "@/tests/helpers/event-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const created: string[] = [];
let counter = 0;

const clear = async () => {
  if (created.length === 0) return;
  const { error } = await db.from("events").delete().in("id", created.splice(0));
  if (error) throw new Error(error.message);
};

afterAll(clear);

defineEventContract("SupabaseEventRepository", () => ({
  repo: () => new SupabaseEventRepository(db),
  seed: async (events) => {
    await clear();
    const ids: Record<string, string> = {};
    for (const e of events) {
      const { data, error } = await db
        .from("events")
        .insert({
          title: e.title,
          slug: `event-contract-${RUN}-${++counter}`,
          event_type: "other",
          starts_at: e.startsAt,
          ends_at: new Date(Date.parse(e.startsAt) + 3_600_000).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids[e.key] = data.id;
      created.push(data.id);
    }
    return ids;
  },
}));

// --- calendar sync ---
const syncEvents: string[] = [];
const syncCalendars: string[] = [];

const clearSync = async () => {
  const eventIds = syncEvents.splice(0);
  const calendarIds = syncCalendars.splice(0);
  if (eventIds.length) {
    const { error } = await db.from("events").delete().in("id", eventIds);
    if (error) throw new Error(error.message);
  }
  if (calendarIds.length) {
    // Events the repository itself created for these calendar events.
    const { error } = await db.from("events").delete().in("calendar_event_id", calendarIds);
    if (error) throw new Error(error.message);
    const { error: calendarError } = await db.schema("bronze").from("calendar_events").delete().in("id", calendarIds);
    if (calendarError) throw new Error(calendarError.message);
  }
};

afterAll(clearSync);

defineEventSyncContract("SupabaseEventRepository", () => ({
  repo: () => new SupabaseEventRepository(db),
  read: async (id) => {
    const { data, error } = await db.from("events").select("title, automatic").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  seed: async (specs) => {
    await clearSync();
    const out = { events: {} as Record<string, string>, slugs: {} as Record<string, string>, calendars: {} as Record<string, string> };
    for (const s of specs) {
      let calendarId: string | null = null;
      if (s.calendar !== false) {
        const { data, error } = await db
          .schema("bronze")
          .from("calendar_events")
          .insert({
            google_event_id: `event-sync-contract-${RUN}-${++counter}`,
            summary: `Sync contract ${s.key}`,
            start_time: "2185-05-02T23:00:00Z",
            end_time: "2185-05-03T01:00:00Z",
            raw_data: {},
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        calendarId = data.id;
        syncCalendars.push(data.id);
        out.calendars[s.key] = data.id;
      }
      if (s.eventless) continue;
      const slug = `event-sync-contract-${RUN}-${++counter}`;
      const { data, error } = await db
        .from("events")
        .insert({
          title: s.key,
          slug,
          event_type: "other",
          starts_at: "2185-05-02",
          ends_at: "2185-05-02",
          calendar_event_id: calendarId,
          automatic: !!s.automatic,
          overridden_fields: s.overridden ?? [],
          deleted_at: s.hidden ? new Date().toISOString() : null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      syncEvents.push(data.id);
      out.events[s.key] = data.id;
      out.slugs[s.key] = slug;
      if (s.photo) {
        const { error: photoError } = await db.from("event_photos").insert({ event_id: data.id, storage_path: `${slug}/p.jpg`, google_media_item_id: `${slug}-p` });
        if (photoError) throw new Error(photoError.message);
      }
    }
    return out;
  },
}));
