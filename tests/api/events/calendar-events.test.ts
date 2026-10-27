import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import type { Db } from "@/lib/data/db";
import { elevateCalendarEvent, ensureCalendarEvents, reconcileAutomaticEvents, syncCalendarEvent, syncCalendarEvents } from "@/lib/calendar-events";

/**
 * Events that follow the shared calendar, against the local database: showing a calendar item in
 * Events, keeping it in step with the calendar without losing an admin's edits, the admin list, and
 * what happens when the calendar event goes away. Far-future dates and a unique token keep this to
 * its own rows, since other tests share the database.
 */

const db = getTestSupabaseAdminClient() as unknown as Db;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "service-role" }, forbidden: false, supabase: getTestSupabaseAdminClient() }),
}));

import { POST as showInEvents } from "@/app/api/admin/events/calendar/route";
import { GET as getEvent, PATCH as editEvent } from "@/app/api/admin/events/[id]/route";
import { POST as revertToCalendar } from "@/app/api/admin/events/[id]/revert-to-calendar/route";
import { POST as setVisibility } from "@/app/api/admin/events/[id]/visibility/route";

const token = `cal${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const calendarIds: string[] = [];
const eventIds: string[] = [];
const cleanups: (() => Promise<void>)[] = []; // rows the prickle-based tests made besides events and calendar events

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

const json = (body: unknown, method = "POST") =>
  new NextRequest("http://localhost/api/admin/events", { method, body: JSON.stringify(body) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function eventRow(id: string) {
  const { data } = await db.from("events").select("*").eq("id", id).single();
  return data!;
}

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
  if (eventIds.length) await db.from("events").delete().in("id", eventIds);
  await db.from("events").delete().in("calendar_event_id", calendarIds);
  if (calendarIds.length) await db.schema("bronze").from("calendar_events").delete().in("id", calendarIds);
});

describe("elevateCalendarEvent", () => {
  it("creates the event that follows a calendar item, with its text, exact times and Eastern dates", async () => {
    const calendarId = await calendarEvent("book-fair");

    const result = await elevateCalendarEvent(db, calendarId, null);

    expect(result).toMatchObject({ ok: true, created: true });
    if (!result.ok) return;
    eventIds.push(result.event.id);
    expect(result.event.slug).toBe(`${token}-book-fair-2185-05-02`);
    expect(await eventRow(result.event.id)).toMatchObject({
      calendar_event_id: calendarId,
      title: `${token} book-fair`,
      description: "From the calendar",
      location: "Zoom",
      event_type: "other",
      starts_at: "2185-05-02",
      ends_at: "2185-05-02",
      overridden_fields: [],
    });
    expect(new Date((await eventRow(result.event.id)).start_time!).toISOString()).toBe("2185-05-02T23:00:00.000Z");
  });

  it("returns the event it already made instead of a second one", async () => {
    const calendarId = await calendarEvent("twice");
    const first = await elevateCalendarEvent(db, calendarId, null);
    const second = await elevateCalendarEvent(db, calendarId, null);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    eventIds.push(first.event.id);
    expect(second).toMatchObject({ created: false, event: { id: first.event.id } });
  });

  it("gives two calendar items with the same title on the same day their own addresses", async () => {
    const a = await calendarEvent("same", { summary: `${token} Same Name w/A` });
    const b = await calendarEvent("same2", { summary: `${token} Same Name w/B` });

    const first = await elevateCalendarEvent(db, a, null);
    const second = await elevateCalendarEvent(db, b, null);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    eventIds.push(first.event.id, second.event.id);
    expect(second.event.slug).toBe(`${first.event.slug}-2`);
  });

  it("says when the calendar item doesn't exist", async () => {
    expect(await elevateCalendarEvent(db, "00000000-0000-4000-8000-000000000000", null)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("syncCalendarEvents", () => {
  it("brings dates, times and un-overridden text up to date, and leaves overridden text alone", async () => {
    const calendarId = await calendarEvent("sync");
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id);
    await db.from("events").update({ title: "Our own title", overridden_fields: ["title"] }).eq("id", made.event.id);

    const moved = {
      id: calendarId,
      summary: `${token} moved w/Ada`,
      description: "<p>Changed in Google</p>",
      location: "Room 9",
      start_time: "2185-05-09T14:00:00Z",
      end_time: "2185-05-09T15:00:00Z",
    };
    const updated = await syncCalendarEvents(db, [moved, { ...moved, id: "00000000-0000-4000-8000-000000000001" }]);

    expect(updated).toBe(1);
    expect(await eventRow(made.event.id)).toMatchObject({
      title: "Our own title", // overridden, kept
      description: "Changed in Google",
      location: "Room 9",
      starts_at: "2185-05-09",
      ends_at: "2185-05-09",
    });
  });

  it("does nothing for no calendar events", async () => {
    expect(await syncCalendarEvents(db, [])).toBe(0);
  });

  it("keeps the event, unlinked, when the calendar event is deleted", async () => {
    const calendarId = await calendarEvent("gone");
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id);

    await db.schema("bronze").from("calendar_events").delete().eq("id", calendarId);

    expect(await eventRow(made.event.id)).toMatchObject({ calendar_event_id: null, title: `${token} gone` });
  });
});

describe("POST /api/admin/events/calendar", () => {
  it("shows an item in Events: 201 the first time, 200 after, 400 for a bad id, 404 for an unknown item", async () => {
    const calendarId = await calendarEvent("route");

    const first = await showInEvents(json({ calendarEventId: calendarId }));
    const second = await showInEvents(json({ calendarEventId: calendarId }));
    const bad = await showInEvents(json({ calendarEventId: "nope" }));
    const unknown = await showInEvents(json({ calendarEventId: "00000000-0000-4000-8000-000000000000" }));
    const notJson = await showInEvents(new NextRequest("http://localhost/api/admin/events/calendar", { method: "POST", body: "{" }));

    expect([first.status, second.status, bad.status, unknown.status, notJson.status]).toEqual([201, 200, 400, 404, 400]);
    eventIds.push((await first.json()).event.id);
  });
});

describe("editing an event that follows the calendar", () => {
  it("remembers only the fields that changed, keeps the calendar's dates, and can follow the calendar again", async () => {
    const calendarId = await calendarEvent("edit");
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    const id = made.event.id;
    eventIds.push(id);
    const before = await eventRow(id);

    // The admin form sends every field; only the title differs.
    const res = await editEvent(
      json({ title: "Renamed", description: before.description, location: before.location, starts_at: "2185-12-25", ends_at: "2185-12-26" }, "PATCH"),
      idParams(id),
    );

    expect(res.status).toBe(200);
    expect(await eventRow(id)).toMatchObject({ title: "Renamed", overridden_fields: ["title"], starts_at: "2185-05-02", ends_at: "2185-05-02" });

    const reverted = await revertToCalendar(json({}), idParams(id));
    expect(reverted.status).toBe(200);
    expect(await eventRow(id)).toMatchObject({ title: `${token} edit`, overridden_fields: [] });
  });

  it("lets an event made in the Hub change its dates, and refuses to follow a calendar it doesn't have", async () => {
    const { data } = await db
      .from("events")
      .insert({ slug: `${token}-local`, title: "Local", event_type: "other", starts_at: "2185-06-01", ends_at: "2185-06-01" })
      .select("id")
      .single();
    eventIds.push(data!.id);

    await editEvent(json({ starts_at: "2185-06-02", ends_at: "2185-06-03" }, "PATCH"), idParams(data!.id));

    expect(await eventRow(data!.id)).toMatchObject({ starts_at: "2185-06-02", ends_at: "2185-06-03", overridden_fields: [] });
    expect((await revertToCalendar(json({}), idParams(data!.id))).status).toBe(400);
    expect((await revertToCalendar(json({}), idParams("evt_ZZZZZZZZZZZZ"))).status).toBe(404);
  });

  it("says when the calendar event is gone", async () => {
    const calendarId = await calendarEvent("revert-gone");
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id);
    // Unlinked after deletion (ON DELETE SET NULL), so it no longer follows anything.
    await db.schema("bronze").from("calendar_events").delete().eq("id", calendarId);

    expect((await revertToCalendar(json({}), idParams(made.event.id))).status).toBe(400);
  });
});

describe("ensureCalendarEvents", () => {
  it("creates an event for each calendar event that has none, and leaves existing and hidden ones alone", async () => {
    const fresh = await calendarEvent("ensure-new");
    const existing = await calendarEvent("ensure-existing");
    const hidden = await calendarEvent("ensure-hidden");
    const made = await elevateCalendarEvent(db, existing, null);
    const hiddenMade = await elevateCalendarEvent(db, hidden, null);
    if (!made.ok || !hiddenMade.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id, hiddenMade.event.id);
    await db.from("events").update({ deleted_at: new Date().toISOString() }).eq("id", hiddenMade.event.id);

    const created = await ensureCalendarEvents(db, [fresh, existing, hidden]);

    expect(created).toBe(1);
    const { data: rows } = await db.from("events").select("id, calendar_event_id, deleted_at").in("calendar_event_id", [fresh, existing, hidden]);
    expect(rows).toHaveLength(3);
    eventIds.push(...rows!.map((r) => r.id));
    expect(rows!.find((r) => r.calendar_event_id === hidden)!.deleted_at).not.toBeNull();
    expect(rows!.find((r) => r.calendar_event_id === fresh)!.deleted_at).toBeNull();
    expect(await ensureCalendarEvents(db, [fresh, existing, hidden])).toBe(0);
    expect(await ensureCalendarEvents(db, [])).toBe(0);
  });

  it("fails when a calendar event doesn't exist", async () => {
    await expect(ensureCalendarEvents(db, ["00000000-0000-4000-8000-000000000000"])).rejects.toThrow("Calendar event not found");
  });
});

describe("POST /api/admin/events/[id]/visibility", () => {
  it("hides an event, shows it again, and says when it can't", async () => {
    const calendarId = await calendarEvent("visibility");
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id);

    const hide = await setVisibility(json({ hidden: true }), idParams(made.event.id));
    expect(hide.status).toBe(200);
    expect((await eventRow(made.event.id)).deleted_at).not.toBeNull();
    const show = await setVisibility(json({ hidden: false }), idParams(made.event.id));
    expect(show.status).toBe(200);
    expect((await eventRow(made.event.id)).deleted_at).toBeNull();

    expect((await setVisibility(json({ hidden: "yes" }), idParams(made.event.id))).status).toBe(400);
    expect((await setVisibility(json({ hidden: true }), idParams("evt_ZZZZZZZZZZZZ"))).status).toBe(404);
    expect((await setVisibility(new NextRequest("http://localhost/x", { method: "POST", body: "{" }), idParams(made.event.id))).status).toBe(400);
  });

  it("reports an existing hidden event as hidden when asked to show the calendar item again", async () => {
    const calendarId = await calendarEvent("elevate-hidden");
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id);
    await db.from("events").update({ deleted_at: new Date().toISOString() }).eq("id", made.event.id);

    const again = await elevateCalendarEvent(db, calendarId, null);

    expect(again).toMatchObject({ ok: true, created: false, event: { id: made.event.id, hidden: true } });
  });
});

describe("an event made from a prickle", () => {
  async function prickleOfType(label: string, flags: { listed_in_events: boolean; announced_publicly: boolean; guests_allowed: boolean; event_kind?: string }) {
    const calendarId = await calendarEvent(label);
    const { data: type } = await db
      .from("prickle_types")
      .insert({ name: `${token} ${label}`, normalized_name: `${token}-${label}`, ...flags })
      .select("id")
      .single();
    const { data: prickle } = await db
      .from("prickles")
      .insert({ type_id: type!.id, start_time: "2185-05-02T23:00:00Z", end_time: "2185-05-03T01:00:00Z", source: "calendar", calendar_event_id: calendarId })
      .select("id")
      .single();
    cleanups.push(async () => {
      await db.from("prickles").delete().eq("id", prickle!.id);
      await db.from("prickle_types").delete().eq("id", type!.id);
    });
    return calendarId;
  }

  it("starts with its prickle type's audience, whether the sync or an admin makes it", async () => {
    const open = await prickleOfType("audience-open", { listed_in_events: true, announced_publicly: true, guests_allowed: true });
    const members = await prickleOfType("audience-members", { listed_in_events: true, announced_publicly: true, guests_allowed: false });
    const plain = await prickleOfType("audience-plain", { listed_in_events: false, announced_publicly: false, guests_allowed: false });

    await ensureCalendarEvents(db, [open, members]);
    const byHand = await elevateCalendarEvent(db, plain, null);
    if (!byHand.ok) throw new Error("elevate failed");
    eventIds.push(byHand.event.id);

    const { data: rows } = await db.from("events").select("id, calendar_event_id, announced_publicly, guests_allowed").in("calendar_event_id", [open, members, plain]);
    eventIds.push(...rows!.map((r) => r.id));
    const flags = (calendarId: string) => {
      const r = rows!.find((x) => x.calendar_event_id === calendarId)!;
      return { announced_publicly: r.announced_publicly, guests_allowed: r.guests_allowed };
    };
    expect(flags(open)).toEqual({ announced_publicly: true, guests_allowed: true });
    expect(flags(members)).toEqual({ announced_publicly: true, guests_allowed: false });
    expect(flags(plain)).toEqual({ announced_publicly: false, guests_allowed: false });
  });

  it("starts as the kind of event its prickle type says, a session when the type says nothing", async () => {
    const edu = await prickleOfType("kind-edu", { listed_in_events: false, announced_publicly: false, guests_allowed: false, event_kind: "educational" });
    const plain = await prickleOfType("kind-plain", { listed_in_events: false, announced_publicly: false, guests_allowed: false });

    await ensureCalendarEvents(db, [edu, plain]);

    const { data: rows } = await db.from("events").select("id, calendar_event_id, event_type").in("calendar_event_id", [edu, plain]);
    eventIds.push(...rows!.map((r) => r.id));
    expect(rows!.find((r) => r.calendar_event_id === edu)!.event_type).toBe("educational");
    expect(rows!.find((r) => r.calendar_event_id === plain)!.event_type).toBe("session");
  });

  it("starts with its prickle's guest speaker, a cleaned title and the title's [Category] as its focus", async () => {
    const calendarId = await calendarEvent("speaker", { summary: `Quill & Cup [Craft] Prickle: ${token} Outlining with Ada Example`, location: "https://us06web.zoom.us/j/123?pwd=x" });
    const { data: type } = await db
      .from("prickle_types")
      .insert({ name: `${token} speaker`, normalized_name: `${token}-speaker` })
      .select("id")
      .single();
    const { data: prickle } = await db
      .from("prickles")
      .insert({ type_id: type!.id, start_time: "2185-05-02T23:00:00Z", end_time: "2185-05-03T01:00:00Z", source: "calendar", calendar_event_id: calendarId, guest_speaker: "Ada Example", title: `${token} Outlining` })
      .select("id")
      .single();
    cleanups.push(async () => {
      await db.from("prickles").delete().eq("id", prickle!.id);
      await db.from("prickle_types").delete().eq("id", type!.id);
    });

    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id);

    expect(await eventRow(made.event.id)).toMatchObject({
      title: `${token} Outlining`,
      focus: "Craft",
      speakers: "Ada Example",
      location: "https://us06web.zoom.us/j/123?pwd=x", // stored as the calendar has it; members see "Online (Zoom)"
    });
  });

  it("starts members only when the calendar item is no prickle", async () => {
    const calendarId = await calendarEvent("audience-none");
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id);

    expect(await eventRow(made.event.id)).toMatchObject({ announced_publicly: false, guests_allowed: false });
  });
});

describe("an event that stands for a prickle", () => {
  async function prickleEvent(label: string, prickleFields: Record<string, unknown> = {}) {
    const calendarId = await calendarEvent(label, { summary: `${token} ${label} w/Ada`, description: "<p>From the calendar</p>" });
    const { data: member } = await db
      .from("members")
      .insert({ name: `Legal ${token} ${label}`, display_name: "Jenny", email: `${token}-${label}@example.com`, joined_at: "2023-01-01", status: "active" })
      .select("id")
      .single();
    const { data: type } = await db.from("prickle_types").insert({ name: `${token} ${label} type`, normalized_name: `${token}-${label}-type` }).select("id").single();
    const { data: prickle } = await db
      .from("prickles")
      .insert({ type_id: type!.id, host: member!.id, start_time: "2185-05-02T23:00:00Z", end_time: "2185-05-03T01:00:00Z", source: "calendar", calendar_event_id: calendarId, description: "From the prickle", ...prickleFields })
      .select("id")
      .single();
    cleanups.push(async () => {
      await db.from("prickles").delete().eq("id", prickle!.id);
      await db.from("prickle_types").delete().eq("id", type!.id);
      await db.from("members").delete().eq("id", member!.id);
    });
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id);
    return { calendarId, prickleId: prickle!.id, eventId: made.event.id, typeName: `${token} ${label} type` };
  }

  it("is made with the prickle's title (or its type's name), description, guest speaker and host's display name", async () => {
    const plain = await prickleEvent("stands-plain");
    const titled = await prickleEvent("stands-titled", { title: `${token} Tiny Things`, guest_speaker: "Ada Example" });

    expect(await eventRow(plain.eventId)).toMatchObject({ title: plain.typeName, description: "From the prickle", speakers: null, host_name: "Jenny" });
    expect(await eventRow(titled.eventId)).toMatchObject({ title: `${token} Tiny Things`, speakers: "Ada Example", host_name: "Jenny" });
  });

  it("follows the prickle on every sync, and a title or description set on the event doesn't hold against it", async () => {
    const { calendarId, prickleId, eventId } = await prickleEvent("stands-follow");
    await db.from("events").update({ title: "Set on the event", description: "Event words", overridden_fields: ["title", "description"] }).eq("id", eventId);

    await db.from("prickles").update({ title: `${token} Edited title`, description: "Edited description", guest_speaker: "Ada Example" }).eq("id", prickleId);
    const source = { id: calendarId, summary: `${token} stands-follow w/Ada`, description: "<p>From the calendar</p>", location: "Zoom", start_time: "2185-05-02T23:00:00Z", end_time: "2185-05-03T01:00:00Z" };
    expect(await syncCalendarEvents(db, [source])).toBe(1);

    expect(await eventRow(eventId)).toMatchObject({ title: `${token} Edited title`, description: "Edited description", speakers: "Ada Example", host_name: "Jenny" });
    // Without a prickle, the same override would have held (the calendar-only events above).
  });

  it("is brought up to date by syncCalendarEvent right after the prickle is edited", async () => {
    const { calendarId, prickleId, eventId } = await prickleEvent("stands-now");
    await db.from("prickles").update({ title: `${token} Right now` }).eq("id", prickleId);

    await syncCalendarEvent(db, calendarId);

    expect((await eventRow(eventId)).title).toBe(`${token} Right now`);
  });

  it("is told apart in the admin API, which leaves the prickle's fields to the prickle but still takes the location and audience", async () => {
    const { prickleId, eventId } = await prickleEvent("stands-api", { title: `${token} Prickle title`, guest_speaker: "Ada Example" });
    const body = await (await getEvent(new NextRequest("http://localhost/x"), idParams(eventId))).json();
    expect(body.prickleId).toBe(prickleId);

    const res = await editEvent(json({ title: "Hijacked", description: "Hijacked", speakers: "Someone Else", location: "Room 9", guests_allowed: false, announced_publicly: true }, "PATCH"), idParams(eventId));

    expect(res.status).toBe(200);
    expect(await eventRow(eventId)).toMatchObject({
      title: `${token} Prickle title`,
      description: "From the prickle",
      speakers: "Ada Example",
      location: "Room 9",
      announced_publicly: true,
      overridden_fields: ["location"],
    });
  });

  it("takes its title and description from the prickle again, not the calendar, when it follows the calendar again", async () => {
    const { eventId } = await prickleEvent("stands-revert", { title: `${token} Prickle title` });
    await editEvent(json({ location: "Room 9" }, "PATCH"), idParams(eventId));

    const reverted = await revertToCalendar(json({}), idParams(eventId));

    expect(reverted.status).toBe(200);
    expect(await eventRow(eventId)).toMatchObject({ title: `${token} Prickle title`, description: "From the prickle", location: "Zoom", overridden_fields: [] });
  });

  it("gets no host or speaker when the calendar item is no prickle", async () => {
    const calendarId = await calendarEvent("stands-none");
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    eventIds.push(made.event.id);

    expect(await eventRow(made.event.id)).toMatchObject({ host_name: null, speakers: null });
    expect((await (await getEvent(new NextRequest("http://localhost/x"), idParams(made.event.id))).json()).prickleId).toBeNull();
  });
});

describe("automatic events", () => {
  it("are made by the sync, and kept once an admin shows the item by hand", async () => {
    const calendarId = await calendarEvent("automatic-keep");
    expect(await ensureCalendarEvents(db, [calendarId])).toBe(1);
    const row = async () => (await db.from("events").select("id, automatic").eq("calendar_event_id", calendarId).single()).data!;
    const made = await row();
    eventIds.push(made.id);
    expect(made.automatic).toBe(true);

    const byHand = await elevateCalendarEvent(db, calendarId, null);

    expect(byHand).toMatchObject({ ok: true, created: false });
    expect((await row()).automatic).toBe(false);
  });

  it("an event shown by hand is not automatic, and an edit keeps an automatic one", async () => {
    const byHandId = await calendarEvent("automatic-by-hand");
    const byHand = await elevateCalendarEvent(db, byHandId, null);
    if (!byHand.ok) throw new Error("elevate failed");
    eventIds.push(byHand.event.id);
    expect((await eventRow(byHand.event.id)).automatic).toBe(false);

    const autoId = await calendarEvent("automatic-edit");
    await ensureCalendarEvents(db, [autoId]);
    const { data: auto } = await db.from("events").select("id").eq("calendar_event_id", autoId).single();
    eventIds.push(auto!.id);
    expect((await eventRow(auto!.id)).automatic).toBe(true);

    await editEvent(json({ focus: "Bring a friend" }, "PATCH"), idParams(auto!.id));

    expect(await eventRow(auto!.id)).toMatchObject({ automatic: false, focus: "Bring a friend" });
  });
});

describe("reconcileAutomaticEvents", () => {
  async function automaticEvent(label: string) {
    const calendarId = await calendarEvent(label);
    await ensureCalendarEvents(db, [calendarId]);
    const { data } = await db.from("events").select("id").eq("calendar_event_id", calendarId).single();
    eventIds.push(data!.id);
    return { calendarId, eventId: data!.id };
  }
  const exists = async (id: string) => (await db.from("events").select("id").eq("id", id)).data!.length === 1;

  it("takes away an automatic event whose reason has stopped applying, and keeps the ones that still have one", async () => {
    const stale = await automaticEvent("reconcile-stale");
    const still = await automaticEvent("reconcile-still");
    const byHand = await calendarEvent("reconcile-by-hand");
    const handMade = await elevateCalendarEvent(db, byHand, null);
    if (!handMade.ok) throw new Error("elevate failed");
    eventIds.push(handMade.event.id);

    const removed = await reconcileAutomaticEvents(db, [stale.calendarId, still.calendarId, byHand], new Set([still.calendarId]));

    expect(removed).toBe(1);
    expect(await exists(stale.eventId)).toBe(false);
    expect(await exists(still.eventId)).toBe(true);
    expect(await exists(handMade.event.id)).toBe(true); // shown by hand: never taken away
  });

  it("leaves alone an event outside the calendar events just processed", async () => {
    const outside = await automaticEvent("reconcile-outside");

    await reconcileAutomaticEvents(db, [], new Set());

    expect(await exists(outside.eventId)).toBe(true);
  });

  it("keeps an automatic event that has been worked on: photos, an attendee list or a badge", async () => {
    const withPhoto = await automaticEvent("reconcile-photo");
    await db.from("event_photos").insert({ event_id: withPhoto.eventId, storage_path: `${token}/p.jpg`, google_media_item_id: `${token}-p` });
    const plain = await automaticEvent("reconcile-plain");

    const removed = await reconcileAutomaticEvents(db, [withPhoto.calendarId, plain.calendarId], new Set());

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await exists(withPhoto.eventId)).toBe(true);
    expect(await exists(plain.eventId)).toBe(false);
  });

  it("takes away an automatic event whose calendar event was deleted", async () => {
    const gone = await automaticEvent("reconcile-gone");
    await db.schema("bronze").from("calendar_events").delete().eq("id", gone.calendarId);
    expect((await eventRow(gone.eventId)).calendar_event_id).toBeNull();

    const removed = await reconcileAutomaticEvents(db, [], new Set());

    expect(removed).toBeGreaterThanOrEqual(0); // a parallel run may have taken it first
    expect(await exists(gone.eventId)).toBe(false);
  });
});

describe("clearing a field of an event that follows the calendar", () => {
  it("follows the calendar again for that field, and goes on following it", async () => {
    const calendarId = await calendarEvent("clear-field");
    const made = await elevateCalendarEvent(db, calendarId, null);
    if (!made.ok) throw new Error("elevate failed");
    const id = made.event.id;
    eventIds.push(id);

    await editEvent(json({ description: "Our own words" }, "PATCH"), idParams(id));
    expect(await eventRow(id)).toMatchObject({ description: "Our own words", overridden_fields: ["description"] });

    await db.schema("bronze").from("calendar_events").update({ description: "<p>Changed in Google</p>" }).eq("id", calendarId);
    const res = await editEvent(json({ description: "" }, "PATCH"), idParams(id));

    expect(res.status).toBe(200);
    expect(await eventRow(id)).toMatchObject({ description: "Changed in Google", overridden_fields: [] });

    // The next sync keeps it in step, since it is no longer overridden.
    await syncCalendarEvents(db, [{ id: calendarId, summary: `${token} clear-field w/Ada`, description: "<p>Newer</p>", location: "Zoom", start_time: "2185-05-02T23:00:00Z", end_time: "2185-05-03T01:00:00Z" }]);
    expect((await eventRow(id)).description).toBe("Newer");
  });

  it("an event made in the Hub can have a field emptied, since it follows nothing", async () => {
    const { data } = await db
      .from("events")
      .insert({ slug: `${token}-hub-clear`, title: "Hub event", event_type: "other", starts_at: "2185-06-01", ends_at: "2185-06-01", description: "Words" })
      .select("id")
      .single();
    eventIds.push(data!.id);

    await editEvent(json({ description: "" }, "PATCH"), idParams(data!.id));

    expect(await eventRow(data!.id)).toMatchObject({ description: "", overridden_fields: [] });
  });
});
