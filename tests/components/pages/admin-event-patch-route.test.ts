/**
 * PATCH /api/admin/events/[id] for an event on a calendar prickle: the title, description, guest speaker, location and
 * host are saved as the calendar item's decision through the shared applyPrickleEdits (what the prickle page's Edit
 * writes); the times are not taken; an event made in the Hub saves to its Hub session instead.
 */
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TYPE_A = "prty_AAAAAAAAAAA1";
const CAL = "00000000-0000-4000-8000-00000000000a";
const HOST = "mbr_AAAAAAAAAAA1";
const type = { id: TYPE_A, name: "Retreat Day", normalizedName: "retreat-day", purpose: "social" as const, requiresHost: false, soloTaskFriendly: false, listedInEvents: true, announcedPublicly: false, guestsAllowed: false };
const calPrickle = { id: "prkl_CAL000000001", typeId: TYPE_A, hostId: null, title: null, description: "From the calendar", guestSpeaker: null, location: "Calendar room", startTime: "2097-03-03T15:00:00Z", endTime: "2097-03-03T16:00:00Z", source: "calendar", calendarEventId: CAL };

let repos: ReturnType<typeof createInMemoryRepos>;
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => ({ ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")), createRepos: () => repos }));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: async () => ({ user: { id: "u1" }, forbidden: false, supabase: {} }) }));
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: vi.fn(async () => ({ processed: [] })) }));

import { PATCH } from "@/app/api/admin/events/[id]/route";

const patch = (id: string, body: Record<string, unknown>) =>
  PATCH(new NextRequest("http://localhost/api/admin/events/" + id, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  dataset = new InMemoryDataset({
    calendarEvents: [
      { id: CAL, google_event_id: "g-cal", summary: "RETREAT DAY", description: null, location: null, raw_data: {}, start_time: "2097-03-03T15:00:00Z", end_time: "2097-03-03T16:00:00Z", creator_email: null, creator_name: null, organizer_email: null, organizer_name: null, imported_at: null },
    ],
    members: [{ id: HOST, name: "Julie Example" }],
    prickleTypes: [type],
    prickles: [calPrickle] as never,
    events: [{ id: "evt_EVENT0000001", slug: "retreat-day", prickle_id: calPrickle.id }],
  });
  repos = createInMemoryRepos(dataset);
});

describe("PATCH /api/admin/events/[id] on a calendar-backed event", () => {
  it("saves the text, guest speaker and host as the decision, shows them marked as edited, and leaves the prickle's times alone", async () => {
    const res = await patch("evt_EVENT0000001", { title: "Our title", description: "Our words", location: "Room 9", speakers: "Ada Example", host_id: HOST, starts_at: "2000-01-01", ends_at: "2000-01-02" });

    expect(res.status).toBe(200);
    expect(dataset.unmatchedEvents).toEqual([
      expect.objectContaining({ calendar_event_id: CAL, resolved_title: "Our title", resolved_description: "Our words", resolved_location: "Room 9", resolved_guest_speaker: "Ada Example", resolved_host_id: HOST }),
    ]);
    expect(await res.json()).toMatchObject({ overridden: { title: true, description: true, guestSpeaker: true, location: true } });
    expect(await repos.prickles.byId(calPrickle.id)).toMatchObject({ title: "Our title", location: "Room 9", startTime: "2097-03-03T15:00:00Z", endTime: "2097-03-03T16:00:00Z" });
    expect(dataset.hubSessions).toEqual([]);
  });

  it("sends a form saved untouched as no override, even when the shown title is the type's name", async () => {
    const res = await patch("evt_EVENT0000001", { title: "Retreat Day", description: "From the calendar", location: "Calendar room", speakers: null, host_id: null, focus: "Craft" });

    expect(res.status).toBe(200);
    expect(dataset.unmatchedEvents).toEqual([]);
    expect(await res.json()).toMatchObject({ overridden: { title: false, description: false, guestSpeaker: false, location: false } });
  });

  it("answers 400 for a host who is not a member, saving nothing", async () => {
    const res = await patch("evt_EVENT0000001", { title: "Our title", host_id: "mbr_ZZZZZZZZZZZ9" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Member not found" });
    expect(dataset.unmatchedEvents).toEqual([]);
  });
});
