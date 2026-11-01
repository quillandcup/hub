// @vitest-environment jsdom
/**
 * The admin prickle page's Edit: a calendar prickle's type, host, title, description and guest speaker are
 * changed, and kept as the calendar event's decision so reprocessing keeps them. Only what really changed is saved,
 * and text left empty follows the calendar again.
 */
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TYPE_A = "prty_AAAAAAAAAAA1";
const TYPE_B = "prty_AAAAAAAAAAA2";
const CAL = "00000000-0000-4000-8000-00000000000a";
const HOST = "mbr_AAAAAAAAAAA1";
const type = (id: string, name: string) => ({ id, name, normalizedName: name.toLowerCase(), purpose: "writing" as const, requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false });
const prickle = (id: string, calendarEventId: string | null) => ({
  id,
  typeId: TYPE_A,
  hostId: null,
  title: "Book Fair Intro",
  description: "From the calendar",
  guestSpeaker: null,
  startTime: "2026-10-05T17:00:00Z",
  endTime: "2026-10-05T18:00:00Z",
  source: "calendar",
  calendarEventId,
});

let repos: ReturnType<typeof createInMemoryRepos>;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

let dataset: InMemoryDataset;
// The client is only handed on (the repositories are in memory); what the action stores is read from the dataset.
const supabase = {};
/** An earlier decision for the first prickle's calendar event. */
const decide = (fields: Record<string, unknown>) =>
  dataset.unmatchedEvents.push({
    id: "u1", calendar_event_id: CAL, raw_summary: "HEDGIE HOUSE BOOK FAIR INTRO!", status: "resolved", created_at: null, resolved_at: null, suggested_host: null, suggested_type: null,
    resolved_type_id: null, resolved_host_id: null, resolved_title: null, resolved_description: null, resolved_guest_speaker: null, resolved_location: null, ...fields,
  });
let admin = true;
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => (admin ? { ok: true, supabase, user: { id: "u1" } } : { ok: false, error: "Not authorized" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/prickle-checkin-dms", () => ({ sendTestCheckinDM: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn() }));
const reprocess = vi.hoisted(() => vi.fn(async () => ({ processed: [] })));
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: reprocess }));
// The event that stands for the prickle follows what was saved (its own tests are with the calendar events).

import { updatePrickle } from "@/app/(admin)/admin/prickles/[id]/actions";

const read = async () => (await repos.prickles.byId("p1"))!;

beforeEach(() => {
  admin = true;
  reprocess.mockClear();
  dataset = new InMemoryDataset({
    // The Bronze calendar item the first prickle follows, whose summary a decision records.
    calendarEvents: [
      {
        id: CAL, google_event_id: "g-cal", summary: "HEDGIE HOUSE BOOK FAIR INTRO!", description: null, location: null, raw_data: {},
        start_time: "2097-03-03T15:00:00Z", end_time: "2097-03-03T16:00:00Z",
        creator_email: null, creator_name: null, organizer_email: null, organizer_name: null, imported_at: null,
      },
    ],
    members: [{ id: HOST, name: "Julie Example" }],
    prickleTypes: [type(TYPE_A, "Hedgie-A-Thon"), type(TYPE_B, "Book Fair")],
    prickles: [prickle("p1", CAL), prickle("p2", null)] as never,
  });
  repos = createInMemoryRepos(dataset);
});

describe("updatePrickle", () => {
  it("saves nothing, and reprocesses nothing, when nothing changed (a form saved untouched)", async () => {
    await expect(updatePrickle("p1", {})).resolves.toEqual({ success: true });
    await expect(updatePrickle("p1", { title: "Book Fair Intro", description: "  From the calendar ", typeId: TYPE_A })).resolves.toEqual({ success: true });

    expect(dataset.unmatchedEvents).toEqual([]);
    expect(reprocess).not.toHaveBeenCalled();
  });

  it("keeps new text as the event's decision and shows it at once, without reprocessing", async () => {
    await expect(updatePrickle("p1", { title: "  Book Fair: Meet the Fair  ", description: "New words", guestSpeaker: "Ada Example" })).resolves.toEqual({ success: true });

    expect(dataset.unmatchedEvents).toEqual([expect.objectContaining({
          calendar_event_id: CAL,
          raw_summary: "HEDGIE HOUSE BOOK FAIR INTRO!",
          status: "resolved",
          resolved_title: "Book Fair: Meet the Fair",
          resolved_description: "New words",
          resolved_guest_speaker: "Ada Example",
        })]);
    expect(await read()).toMatchObject({ title: "Book Fair: Meet the Fair", description: "New words", guestSpeaker: "Ada Example" });
    expect(reprocess).not.toHaveBeenCalled();
  });

  it("keeps a new location as the decision, shows it at once, and follows the calendar again when emptied", async () => {
    await updatePrickle("p1", { location: "  Cedar Lodge " });

    expect(dataset.unmatchedEvents).toEqual([expect.objectContaining({ resolved_location: "Cedar Lodge" })]);
    expect(await read()).toMatchObject({ location: "Cedar Lodge" });
    expect(reprocess).not.toHaveBeenCalled();

    await updatePrickle("p1", { location: "" });

    expect(dataset.unmatchedEvents).toEqual([expect.objectContaining({ resolved_location: null })]);
    expect(reprocess).toHaveBeenCalledTimes(1);
  });

  it("rewrites an earlier decision instead of adding another", async () => {
    decide({ resolved_title: "Earlier title" });

    await updatePrickle("p1", { title: "Later title" });

    expect(dataset.unmatchedEvents).toEqual([expect.objectContaining({ resolved_title: "Later title" })]);
  });

  it("changes the host straight away, and the type with a reprocess of the days around it", async () => {
    await updatePrickle("p1", { hostId: HOST });
    expect(dataset.unmatchedEvents).toEqual([expect.objectContaining({ resolved_host_id: HOST })]);
    expect((await read()).hostId).toBe(HOST);
    expect(reprocess).not.toHaveBeenCalled();

    await updatePrickle("p1", { typeId: TYPE_B });
    expect(dataset.unmatchedEvents).toEqual([expect.objectContaining({ resolved_type_id: TYPE_B })]);
    expect((await read()).typeId).toBe(TYPE_B);
    // The new type changes what the title and speaker are made from, so the day before to the day after is rebuilt.
    expect(reprocess).toHaveBeenCalledWith("prickle_types", "local", {
      dateRange: { from: new Date("2026-10-04T17:00:00Z"), to: new Date("2026-10-06T18:00:00Z") },
    });
  });

  it("follows the calendar again for text emptied that had been set by hand, and says nothing for text that never was", async () => {
    decide({ resolved_title: "Set by hand", resolved_description: null, resolved_guest_speaker: null, resolved_location: null });

    await updatePrickle("p1", { title: "  ", description: "", guestSpeaker: "" });

    expect(dataset.unmatchedEvents).toEqual([expect.objectContaining({ resolved_title: null })]);
    expect(dataset.unmatchedEvents[0]).toMatchObject({ resolved_description: null, resolved_guest_speaker: null, resolved_location: null });
    expect(reprocess).toHaveBeenCalledTimes(1); // the calendar's text comes back
    expect((await read()).title).toBe("Book Fair Intro"); // until that runs
  });

  it("does nothing for emptied text that was never set by hand", async () => {
    await updatePrickle("p1", { guestSpeaker: "", description: "" });

    expect(dataset.unmatchedEvents).toEqual([]);
    expect(reprocess).not.toHaveBeenCalled();
  });

  it("changes nothing when the calendar event is gone, since the change wouldn't last", async () => {
    dataset.calendarEvents = [];

    expect(await updatePrickle("p1", { title: "New" })).toEqual({ error: "The calendar event is gone, so the change wouldn't last" });
    expect((await read()).title).toBe("Book Fair Intro");
  });

  it("refuses a non-admin, a missing prickle, a prickle without a calendar event, an unknown type and an unknown member", async () => {
    expect(await updatePrickle("p1", { typeId: "prty_ZZZZZZZZZZZ9" })).toEqual({ error: "Unknown prickle type" });
    expect(await updatePrickle("p1", { hostId: "mbr_ZZZZZZZZZZZ9" })).toEqual({ error: "Member not found" });
    expect(await updatePrickle("nope", { title: "x" })).toEqual({ error: "Prickle not found" });
    expect(await updatePrickle("p2", { title: "x" })).toEqual({ error: "Only prickles made from a calendar event can be edited here" });
    admin = false;
    expect(await updatePrickle("p1", { title: "x" })).toEqual({ error: "Not authorized" });
    expect(dataset.unmatchedEvents).toEqual([]);
  });
});
