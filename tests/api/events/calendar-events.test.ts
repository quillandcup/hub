import { afterAll, describe, expect, it } from "vitest";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import type { Db } from "@/lib/data/db";
import { elevateCalendarEvent, ensureCalendarEvents, reconcileAutomaticEvents } from "@/lib/calendar-events";

/**
 * Events that stand on the prickle of a shared-calendar item, against the local database: showing an
 * item in Events (making an Event-type prickle when it matched no type), the automatic events the
 * calendar sync makes, and what happens when the calendar item goes away. Far-future dates and a unique
 * token keep this to its own rows, since other tests share the database.
 */

const db = getTestSupabaseAdminClient() as unknown as Db;

const token = `cal${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const calendarIds: string[] = [];
const eventIds: string[] = [];
const prickleIds: string[] = [];

async function calendarEvent(label: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await db
    .schema("bronze")
    .from("calendar_events")
    .insert({
      google_event_id: `${token}-${label}`,
      summary: `${token} ${label} w/Ada`,
      description: "<p>From the calendar</p>",
      location: "Zoom",
      start_time: "2185-05-02T23:00:00Z",
      end_time: "2185-05-03T01:00:00Z",
      raw_data: {},
      ...extra,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  calendarIds.push(data!.id);
  return data!.id;
}

async function prickleFor(calendarEventId: string, typeNormalizedName: string) {
  const { data: type } = await db.from("prickle_types").select("id").eq("normalized_name", typeNormalizedName).single();
  const { data, error } = await db
    .from("prickles")
    .insert({ type_id: type!.id, start_time: "2185-05-02T23:00:00Z", end_time: "2185-05-03T01:00:00Z", source: "calendar", calendar_event_id: calendarEventId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  prickleIds.push(data!.id);
  return data!.id;
}

const eventRow = async (id: string) => (await db.from("community_event_details").select("*").eq("id", id).single()).data!;
const exists = async (id: string) => (await db.from("community_events").select("id").eq("id", id)).data!.length === 1;

afterAll(async () => {
  if (eventIds.length) await db.from("community_events").delete().in("id", eventIds);
  const { data: made } = await db.from("prickles").select("id").in("calendar_event_id", calendarIds);
  const ids = [...prickleIds, ...(made ?? []).map((p) => p.id)];
  if (ids.length) {
    await db.from("community_events").delete().in("prickle_id", ids);
    await db.from("prickles").delete().in("id", ids);
  }
  if (calendarIds.length) await db.schema("bronze").from("calendar_events").delete().in("id", calendarIds);
});

describe("elevateCalendarEvent", () => {
  it("makes the event on the item's prickle, reading its schedule from the prickle, and returns it the second time", async () => {
    const calendarId = await calendarEvent("on-prickle");
    const prickleId = await prickleFor(calendarId, "progress");

    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error(made.error);
    eventIds.push(made.event.id);
    const again = await elevateCalendarEvent(db, calendarId, null);

    expect(made).toMatchObject({ ok: true, created: true });
    expect(again).toMatchObject({ ok: true, created: false, event: { id: made.event.id } });
    expect(await eventRow(made.event.id)).toMatchObject({ prickle_id: prickleId, starts_at: "2185-05-02", ends_at: "2185-05-02" });
  });

  it("makes an Event-type prickle for an item that matched no prickle type, once", async () => {
    const calendarId = await calendarEvent("no-type", { summary: `Quill & Cup [Retreat] Prickle: ${token} Spring Retreat` });

    const made = await elevateCalendarEvent(db, calendarId, null, true);
    if (!made.ok) throw new Error(made.error);
    eventIds.push(made.event.id);
    await elevateCalendarEvent(db, calendarId, null, true);

    const { data: prickles } = await db.from("prickles").select("id, source, title, location, host, prickle_types(normalized_name)").eq("calendar_event_id", calendarId);
    expect(prickles).toHaveLength(1);
    expect(prickles![0]).toMatchObject({ source: "calendar", title: `${token} Spring Retreat`, location: "Zoom", host: null, prickle_types: { normalized_name: "event" } });
    expect(await eventRow(made.event.id)).toMatchObject({ title: `${token} Spring Retreat`, focus: "Retreat", automatic: true, slug: `${token}-spring-retreat-2185-05-02`.toLowerCase() });
  });

  it("gives two items with the same title on the same day their own addresses", async () => {
    const a = await calendarEvent("same-a", { summary: `${token} Same` });
    const b = await calendarEvent("same-b", { summary: `${token} Same` });
    await prickleFor(a, "progress");
    await prickleFor(b, "progress");

    const first = await elevateCalendarEvent(db, a, null);
    const second = await elevateCalendarEvent(db, b, null);
    if (!first.ok || !second.ok) throw new Error("elevate failed");
    eventIds.push(first.event.id, second.event.id);

    expect(second.event.slug).not.toBe(first.event.slug);
  });

  it("says when the calendar item doesn't exist", async () => {
    expect(await elevateCalendarEvent(db, "00000000-0000-4000-8000-0000000000aa", null)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("ensureCalendarEvents", () => {
  it("creates an event for each calendar item that has none, and leaves existing and hidden ones alone", async () => {
    const fresh = await calendarEvent("ensure-fresh");
    const hidden = await calendarEvent("ensure-hidden");
    await prickleFor(fresh, "progress");
    await prickleFor(hidden, "progress");
    const hiddenMade = await elevateCalendarEvent(db, hidden, null);
    if (!hiddenMade.ok) throw new Error("elevate failed");
    eventIds.push(hiddenMade.event.id);
    await db.from("community_events").update({ deleted_at: new Date().toISOString() }).eq("id", hiddenMade.event.id);

    expect(await ensureCalendarEvents(db, [fresh, hidden])).toBe(1);
    expect(await ensureCalendarEvents(db, [fresh, hidden])).toBe(0);
    expect((await eventRow(hiddenMade.event.id)).deleted_at).not.toBeNull();
  });
});

describe("reconcileAutomaticEvents", () => {
  async function automaticEvent(label: string) {
    const calendarId = await calendarEvent(label);
    await prickleFor(calendarId, "progress");
    await ensureCalendarEvents(db, [calendarId]);
    const { data: p } = await db.from("prickles").select("id").eq("calendar_event_id", calendarId).single();
    const { data } = await db.from("community_events").select("id").eq("prickle_id", p!.id).single();
    eventIds.push(data!.id);
    return { calendarId, eventId: data!.id };
  }

  it("takes away an automatic event whose reason has stopped applying, keeps the ones that still have one and hand-made ones", async () => {
    const stale = await automaticEvent("reconcile-stale");
    const still = await automaticEvent("reconcile-still");
    const byHand = await calendarEvent("reconcile-by-hand");
    await prickleFor(byHand, "progress");
    const handMade = await elevateCalendarEvent(db, byHand, null);
    if (!handMade.ok) throw new Error("elevate failed");
    eventIds.push(handMade.event.id);

    const removed = await reconcileAutomaticEvents(db, [stale.calendarId, still.calendarId, byHand], new Set([still.calendarId]));

    expect(removed).toBe(1);
    expect(await exists(stale.eventId)).toBe(false);
    expect(await exists(still.eventId)).toBe(true);
    expect(await exists(handMade.event.id)).toBe(true);
  });

  it("keeps an automatic event that has been worked on (photos)", async () => {
    const withPhoto = await automaticEvent("reconcile-photo");
    await db.from("event_photos").insert({ event_id: withPhoto.eventId, storage_path: `${token}/p.jpg`, google_media_item_id: `${token}-p` });

    await reconcileAutomaticEvents(db, [withPhoto.calendarId], new Set());

    expect(await exists(withPhoto.eventId)).toBe(true);
  });

  it("keeps the event and its prickle when the calendar item is deleted, unless it is automatic and unworked", async () => {
    const worked = await automaticEvent("reconcile-gone-worked");
    await db.from("event_photos").insert({ event_id: worked.eventId, storage_path: `${token}/q.jpg`, google_media_item_id: `${token}-q` });
    const unworked = await automaticEvent("reconcile-gone");
    await db.schema("bronze").from("calendar_events").delete().in("id", [worked.calendarId, unworked.calendarId]);

    await reconcileAutomaticEvents(db, [], new Set());

    expect(await exists(worked.eventId)).toBe(true);
    expect((await eventRow(worked.eventId)).title).toBeTruthy();
    expect(await exists(unworked.eventId)).toBe(false);
  });
});
