/**
 * applyPrickleEdits: the one place a calendar prickle is edited (the prickle page and the event page both call it).
 * Edits are kept as the calendar item's decision so reprocessing keeps them; only what changed is saved; text left
 * empty follows the calendar again and the days around the prickle are reprocessed at once.
 */
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TYPE_A = "prty_AAAAAAAAAAA1";
const CAL = "00000000-0000-4000-8000-00000000000a";
const HOST = "mbr_AAAAAAAAAAA1";
const type = { id: TYPE_A, name: "Hedgie-A-Thon", normalizedName: "hedgie-a-thon", purpose: "writing" as const, requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const prickle = (id: string, calendarEventId: string | null) => ({
  id, typeId: TYPE_A, hostId: null, title: "Book Fair Intro", description: "From the calendar", guestSpeaker: null, location: "Calendar room",
  startTime: "2026-10-05T17:00:00Z", endTime: "2026-10-05T18:00:00Z", source: "calendar", calendarEventId,
});

let repos: ReturnType<typeof createInMemoryRepos>;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
const reprocess = vi.hoisted(() => vi.fn(async () => ({ processed: [] })));
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: reprocess }));

import { applyPrickleEdits } from "@/lib/prickle-edits";

let dataset: InMemoryDataset;
const db = {} as never;
const read = async () => (await repos.prickles.byId("p1"))!;

beforeEach(() => {
  reprocess.mockClear();
  dataset = new InMemoryDataset({
    calendarEvents: [
      { id: CAL, google_event_id: "g-cal", summary: "BOOK FAIR INTRO", description: null, location: null, raw_data: {}, start_time: "2097-03-03T15:00:00Z", end_time: "2097-03-03T16:00:00Z", creator_email: null, creator_name: null, organizer_email: null, organizer_name: null, imported_at: null },
    ],
    members: [{ id: HOST, name: "Julie Example" }],
    prickleTypes: [type],
    prickles: [prickle("p1", CAL), prickle("p2", null)] as never,
  });
  repos = createInMemoryRepos(dataset);
});

describe("applyPrickleEdits", () => {
  it("saves the title, description, guest speaker, location and host as the calendar item's decision, and shows them at once", async () => {
    await expect(applyPrickleEdits(db, "p1", { title: " New title ", description: "New words", guestSpeaker: "Ada Example", location: "Room 9", hostId: HOST })).resolves.toEqual({ ok: true });

    expect(dataset.unmatchedEvents).toEqual([
      expect.objectContaining({ calendar_event_id: CAL, status: "resolved", resolved_title: "New title", resolved_description: "New words", resolved_guest_speaker: "Ada Example", resolved_location: "Room 9", resolved_host_id: HOST }),
    ]);
    expect(await read()).toMatchObject({ title: "New title", description: "New words", guestSpeaker: "Ada Example", location: "Room 9", hostId: HOST });
    expect(reprocess).not.toHaveBeenCalled();
  });

  it("saves only what changed: an untouched form sets no override and reprocesses nothing", async () => {
    await expect(applyPrickleEdits(db, "p1", { title: "Book Fair Intro", description: " From the calendar ", location: "Calendar room" })).resolves.toEqual({ ok: true });

    expect(dataset.unmatchedEvents).toEqual([]);
    expect(reprocess).not.toHaveBeenCalled();
  });

  it("follows the calendar again when a field set by hand is emptied, and reprocesses the days around the prickle", async () => {
    await applyPrickleEdits(db, "p1", { location: "Room 9" });
    expect(reprocess).not.toHaveBeenCalled();

    await applyPrickleEdits(db, "p1", { location: "  " });

    expect(dataset.unmatchedEvents).toEqual([expect.objectContaining({ resolved_location: null })]);
    expect(reprocess).toHaveBeenCalledTimes(1);
    const [, , options] = reprocess.mock.calls[0] as unknown as [string, string, { dateRange: { from: Date; to: Date } }];
    expect(options.dateRange.from.toISOString()).toBe("2026-10-04T17:00:00.000Z");
    expect(options.dateRange.to.toISOString()).toBe("2026-10-06T18:00:00.000Z");
  });

  it("does nothing for an emptied field that was never set by hand", async () => {
    await applyPrickleEdits(db, "p1", { guestSpeaker: "" });

    expect(dataset.unmatchedEvents).toEqual([]);
    expect(reprocess).not.toHaveBeenCalled();
  });

  it("refuses a missing prickle, one with no calendar item, and an unknown member or type", async () => {
    await expect(applyPrickleEdits(db, "nope", { title: "x" })).resolves.toMatchObject({ ok: false, status: 404 });
    await expect(applyPrickleEdits(db, "p2", { title: "x" })).resolves.toMatchObject({ ok: false, status: 400, error: expect.stringContaining("calendar event") });
    await expect(applyPrickleEdits(db, "p1", { hostId: "mbr_ZZZZZZZZZZZ9" })).resolves.toMatchObject({ ok: false, status: 400, error: "Member not found" });
    await expect(applyPrickleEdits(db, "p1", { typeId: "prty_ZZZZZZZZZZZ9" })).resolves.toMatchObject({ ok: false, status: 400, error: "Unknown prickle type" });
    expect(dataset.unmatchedEvents).toEqual([]);
  });
});
