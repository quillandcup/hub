import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseEventRepository } from "@/lib/data/events";
import { defineEventContract, defineEventSyncContract, defineMemberEventContract } from "@/tests/helpers/event-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const created: string[] = [];
const calendarIds: string[] = [];
const memberIds: string[] = [];
let counter = 0;

const clear = async () => {
  if (created.length > 0) {
    const { error } = await db.from("events").delete().in("id", created.splice(0));
    if (error) throw new Error(error.message);
  }
};

afterAll(async () => {
  await clear();
  if (calendarIds.length > 0) await db.schema("bronze").from("calendar_events").delete().in("id", calendarIds);
  if (memberIds.length > 0) await db.from("members").delete().in("id", memberIds);
});

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
          calendar_event_id: e.calendarEventId ?? null,
          deleted_at: e.deletedAt ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids[e.key] = data.id;
      created.push(data.id);
    }
    return ids;
  },
  calendarEvent: async () => {
    const { data, error } = await db
      .schema("bronze")
      .from("calendar_events")
      .insert({
        google_event_id: `event-contract-${RUN}-${++counter}`,
        summary: "Contract",
        start_time: "2097-03-01T09:00:00Z",
        end_time: "2097-03-01T10:00:00Z",
        raw_data: {},
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    calendarIds.push(data.id);
    return data.id;
  },
  member: async (m) => {
    const n = ++counter;
    const { data, error } = await db
      .from("members")
      .insert({ name: m.name, display_name: m.displayName, email: `event-contract-${RUN}-${n}-${m.email}`, status: "active", joined_at: "2097-01-01T00:00:00Z" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    memberIds.push(data.id);
    return data.id;
  },
  attend: async (eventId, memberId, createdAt) => {
    const { error } = await db.from("event_attendees").insert({ event_id: eventId, member_id: memberId, created_at: createdAt });
    if (error) throw new Error(error.message);
  },
  photo: async (eventId, p) => {
    const { data, error } = await db
      .from("event_photos")
      .insert({
        event_id: eventId,
        google_media_item_id: `event-contract-${RUN}-${++counter}`,
        storage_path: p.path,
        taken_at: p.takenAt,
        created_at: p.createdAt,
        hidden_at: p.hidden ? p.createdAt : null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  },
  track: (eventId) => {
    created.push(eventId);
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

// --- member-facing reads ---
const MEMBER_RUN = `m${Date.now()}`;
const memberEventIds: string[] = [];
const memberRowIds: string[] = [];
let memberCounter = 0;

afterAll(async () => {
  if (memberEventIds.length) await db.from("events").delete().in("id", memberEventIds);
  if (memberRowIds.length) await db.from("members").delete().in("id", memberRowIds);
});

defineMemberEventContract("SupabaseEventRepository", () => ({
  repo: () => new SupabaseEventRepository(db),
  token: `tok${MEMBER_RUN}x${++memberCounter}`,
  event: async (e) => {
    const { data, error } = await db
      .from("events")
      .insert({
        title: e.title,
        slug: `event-member-${MEMBER_RUN}-${++memberCounter}`,
        event_type: "other",
        starts_at: e.startsAt,
        ends_at: e.endsAt ?? e.startsAt,
        deleted_at: e.hidden ? "2097-01-01T00:00:00Z" : null,
        speakers: e.speakers ?? null,
        host_name: e.hostName ?? null,
        location: e.location ?? null,
        focus: e.focus ?? null,
        description: e.description ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    memberEventIds.push(data.id);
    return data.id;
  },
  photo: async (eventId, p) => {
    const { data, error } = await db
      .from("event_photos")
      .insert({
        event_id: eventId,
        google_media_item_id: `gm-${MEMBER_RUN}-${++memberCounter}`,
        storage_path: `contract/${MEMBER_RUN}/${memberCounter}`,
        hidden_at: p.hidden ? "2097-01-01T00:00:00Z" : null,
        taken_at: p.takenAt ?? null,
        width: p.width ?? null,
        height: p.height ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  },
  member: async () => {
    const { data, error } = await db
      .from("members")
      .insert({ name: `Event Contract Member ${MEMBER_RUN} ${++memberCounter}`, email: `event-contract-${MEMBER_RUN}-${memberCounter}@example.test`, joined_at: "2026-01-01", status: "active" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    memberRowIds.push(data.id);
    return data.id;
  },
  attend: async (eventId, memberId) => {
    const { error } = await db.from("event_attendees").insert({ event_id: eventId, member_id: memberId });
    if (error) throw new Error(error.message);
  },
}));
