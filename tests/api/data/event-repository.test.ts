import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseEventRepository } from "@/lib/data/events";
import { SupabaseHubSessionRepository } from "@/lib/data/hub-sessions";
import { defineEventContract, defineEventSyncContract, defineMemberEventContract, type SeedPrickle } from "@/tests/helpers/event-contract";
import { defineHubSessionContract } from "@/tests/helpers/hub-session-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const created: string[] = [];
const prickleIds: string[] = [];
const calendarIds: string[] = [];
const memberIds: string[] = [];
const sessionIds: string[] = [];
let counter = 0;

let eventTypeIdCache: string | undefined;
const eventTypeId = async () => {
  if (!eventTypeIdCache) {
    const { data, error } = await db.from("prickle_types").select("id").eq("normalized_name", "event").single();
    if (error) throw new Error(error.message);
    eventTypeIdCache = data.id;
  }
  return eventTypeIdCache;
};

const newPrickle = async (p: SeedPrickle & { hostId?: string; description?: string }, calendarEventId: string | null = p.calendarEventId ?? null) => {
  const { data, error } = await db
    .from("prickles")
    .insert({
      source: "calendar",
      type_id: await eventTypeId(),
      title: p.title,
      location: p.location ?? null,
      guest_speaker: p.guestSpeaker ?? null,
      description: p.description ?? null,
      host: p.hostId ?? null,
      start_time: p.startTime,
      end_time: p.endTime,
      calendar_event_id: calendarEventId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  prickleIds.push(data.id);
  return data.id;
};

const clear = async () => {
  if (created.length > 0) {
    const { error } = await db.from("community_events").delete().in("id", created.splice(0));
    if (error) throw new Error(error.message);
  }
};

const clearPrickles = async () => {
  if (prickleIds.length > 0) {
    const { error } = await db.from("prickles").delete().in("id", prickleIds.splice(0));
    if (error) throw new Error(error.message);
  }
};

afterAll(async () => {
  await clear();
  await clearPrickles();
  if (hubEvents.length) await db.from("community_events").delete().in("id", hubEvents.splice(0));
  // Sessions a test left behind take their hub prickles with them (on delete cascade).
  if (sessionIds.length > 0) await db.from("hub_sessions").delete().in("id", sessionIds.splice(0));
  if (calendarIds.length > 0) await db.schema("bronze").from("calendar_events").delete().in("id", calendarIds);
  if (memberIds.length > 0) await db.from("members").delete().in("id", memberIds);
});

const newCalendarEvent = async () => {
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
};

defineEventContract("SupabaseEventRepository", () => ({
  repo: () => new SupabaseEventRepository(db),
  seed: async (events) => {
    await clear();
    const ids: Record<string, string> = {};
    for (const e of events) {
      const prickleId = await newPrickle({ title: e.title, startTime: e.startsAt, endTime: new Date(Date.parse(e.startsAt) + 3_600_000).toISOString() }, e.calendarEventId ?? null);
      const { data, error } = await db
        .from("community_events")
        .insert({ slug: `event-contract-${RUN}-${++counter}`, event_type: "other", prickle_id: prickleId, deleted_at: e.deletedAt ?? null })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids[e.key] = data.id;
      created.push(data.id);
    }
    return ids;
  },
  calendarEvent: newCalendarEvent,
  prickle: (p) => newPrickle(p),
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
const syncPrickles: string[] = [];

const clearSync = async () => {
  const eventIds = syncEvents.splice(0);
  const prickles = syncPrickles.splice(0);
  const calendars = syncCalendars.splice(0);
  if (eventIds.length) {
    const { error } = await db.from("community_events").delete().in("id", eventIds);
    if (error) throw new Error(error.message);
  }
  if (prickles.length) {
    // Events the repository itself created on these prickles.
    const { error } = await db.from("community_events").delete().in("prickle_id", prickles);
    if (error) throw new Error(error.message);
    const { error: prickleError } = await db.from("prickles").delete().in("id", prickles);
    if (prickleError) throw new Error(prickleError.message);
  }
  if (calendars.length) {
    const { error } = await db.schema("bronze").from("calendar_events").delete().in("id", calendars);
    if (error) throw new Error(error.message);
  }
};

afterAll(clearSync);

defineEventSyncContract("SupabaseEventRepository", () => ({
  repo: () => new SupabaseEventRepository(db),
  read: async (id) => {
    const { data, error } = await db.from("community_events").select("focus, automatic").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  seed: async (specs) => {
    await clearSync();
    const out = { events: {} as Record<string, string>, slugs: {} as Record<string, string>, calendars: {} as Record<string, string>, prickles: {} as Record<string, string> };
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
      const { data: prickle, error: prickleError } = await db
        .from("prickles")
        .insert({ source: "calendar", type_id: await eventTypeId(), title: s.key, start_time: "2185-05-02T23:00:00Z", end_time: "2185-05-03T01:00:00Z", calendar_event_id: calendarId })
        .select("id")
        .single();
      if (prickleError) throw new Error(prickleError.message);
      syncPrickles.push(prickle.id);
      out.prickles[s.key] = prickle.id;
      if (s.eventless) continue;
      const slug = `event-sync-contract-${RUN}-${++counter}`;
      const { data, error } = await db
        .from("community_events")
        .insert({
          slug,
          event_type: "other",
          prickle_id: prickle.id,
          automatic: !!s.automatic,
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
const memberPrickleIds: string[] = [];
const memberRowIds: string[] = [];
let memberCounter = 0;

const newMember = async (name: string) => {
  const { data, error } = await db
    .from("members")
    .insert({ name, email: `event-contract-${MEMBER_RUN}-${++memberCounter}@example.test`, joined_at: "2026-01-01", status: "active" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  memberRowIds.push(data.id);
  return data.id;
};

afterAll(async () => {
  if (memberEventIds.length) await db.from("community_events").delete().in("id", memberEventIds);
  if (memberPrickleIds.length) await db.from("prickles").delete().in("id", memberPrickleIds);
  if (memberRowIds.length) await db.from("members").delete().in("id", memberRowIds);
});

defineMemberEventContract("SupabaseEventRepository", () => ({
  repo: () => new SupabaseEventRepository(db),
  token: `tok${MEMBER_RUN}x${++memberCounter}`,
  event: async (e) => {
    const hostId = e.hostName ? await newMember(e.hostName) : null;
    const { data: prickle, error: prickleError } = await db
      .from("prickles")
      .insert({
        source: "calendar",
        type_id: await eventTypeId(),
        title: e.title,
        description: e.description ?? null,
        location: e.location ?? null,
        guest_speaker: e.speakers ?? null,
        host: hostId,
        // Noon UTC is the same Eastern day; the end day gets 13:00 UTC.
        start_time: `${e.startsAt}T12:00:00Z`,
        end_time: `${e.endsAt ?? e.startsAt}T13:00:00Z`,
        calendar_event_id: null,
      })
      .select("id")
      .single();
    if (prickleError) throw new Error(prickleError.message);
    memberPrickleIds.push(prickle.id);
    const { data, error } = await db
      .from("community_events")
      .insert({
        slug: `event-member-${MEMBER_RUN}-${++memberCounter}`,
        event_type: "other",
        prickle_id: prickle.id,
        deleted_at: e.hidden ? "2097-01-01T00:00:00Z" : null,
        focus: e.focus ?? null,
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
  member: () => newMember(`Event Contract Member ${MEMBER_RUN} ${memberCounter + 1}`),
  attend: async (eventId, memberId) => {
    const { error } = await db.from("event_attendees").insert({ event_id: eventId, member_id: memberId });
    if (error) throw new Error(error.message);
  },
}));

// --- hub sessions (run as the service role, which the app's server code uses) ---
const hubEvents: string[] = [];
class TrackingHubSessions extends SupabaseHubSessionRepository {
  async create(fields: Parameters<SupabaseHubSessionRepository["create"]>[0]) {
    const made = await super.create(fields);
    sessionIds.push(made.id);
    return made;
  }
}
const hubRepo = new TrackingHubSessions(db);

defineHubSessionContract("SupabaseHubSessionRepository", () => ({
  repo: () => hubRepo,
  events: () => new SupabaseEventRepository(db),
  standEventOn: async (prickleId) => {
    const { data, error } = await db.from("community_events").insert({ slug: `event-hub-${RUN}-${++counter}`, event_type: "other", prickle_id: prickleId }).select("id").single();
    if (error) throw new Error(error.message);
    hubEvents.push(data.id);
    return data.id;
  },
  removeEvent: async (eventId) => {
    const { error } = await db.from("community_events").delete().eq("id", eventId);
    if (error) throw new Error(error.message);
  },
  prickle: async (prickleId) => {
    const { data, error } = await db.from("prickles").select("source, hub_session_id, title, location, type_id, start_time").eq("id", prickleId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { source: data.source, hubSessionId: data.hub_session_id, title: data.title, location: data.location, typeId: data.type_id, startTime: data.start_time } : null;
  },
  eventTypeId,
  member: async () => newMember(`Hub Host ${MEMBER_RUN}`),
}));
