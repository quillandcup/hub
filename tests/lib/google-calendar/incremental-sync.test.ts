import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { coversSyncWindow, syncCalendarChanges, syncWindow } from "@/lib/google-calendar/incremental-sync";

const state = vi.hoisted(() => ({
  claims: [] as boolean[],
  syncedThrough: null as Date | null,
  releases: [] as boolean[],
  saved: [] as Date[],
  abandoned: 0,
}));

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/repos")>()),
  createRepos: () => createInMemoryRepos(dataset),
}));
vi.mock("@/lib/google-calendar/sync-state", () => ({
  claimCalendarSync: vi.fn(async () =>
    state.claims.shift() === false ? { claimed: false } : { claimed: true, syncedThrough: state.syncedThrough }
  ),
  releaseCalendarSync: vi.fn(async () => state.releases.shift() ?? true),
  saveSyncedThrough: vi.fn(async (_db: unknown, _id: string, at: Date) => void state.saved.push(at)),
  abandonCalendarSync: vi.fn(async () => void state.abandoned++),
}));

const NOW = new Date("2026-10-28T12:00:00Z");
vi.mock("@/lib/clock", () => ({ clock: { now: () => NOW.getTime() } }));

const timed = (id: string, start: string, end: string, extra: object = {}) => ({
  id,
  summary: `Event ${id}`,
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});

function setup(changed: unknown[] = []) {
  const client = { listChangedEvents: vi.fn(async () => changed) };
  const fullSync = vi.fn(async () => ({}));
  const reprocess = vi.fn(async () => ({}));
  const run = () =>
    syncCalendarChanges({ supabase: {} as never, client, calendarId: "cal@example.test", fullSync, reprocess });
  return { client, fullSync, reprocess, run };
}

describe("syncCalendarChanges", () => {
  beforeEach(() => {
    dataset = new InMemoryDataset();
    Object.assign(state, { claims: [], syncedThrough: new Date("2026-10-28T11:00:00Z"), releases: [], saved: [], abandoned: 0 });
  });

  it("fetches only what changed since the watermark (with a few minutes of overlap) inside the sync window", async () => {
    const { client, run } = setup();
    await run();
    expect(client.listChangedEvents).toHaveBeenCalledWith("cal@example.test", {
      updatedMin: "2026-10-28T10:55:00.000Z",
      ...syncWindow(NOW),
    });
  });

  it("stores changed events, moves the watermark to when it began, and reprocesses just their dates", async () => {
    const { run, reprocess, fullSync } = setup([timed("a", "2026-10-31T19:00:00Z", "2026-10-31T20:00:00Z")]);
    const result = await run();

    expect(fullSync).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "done", runs: [{ mode: "incremental", changed: 1, deleted: 0 }] });
    expect(dataset.calendarEvents.map((e) => [e.google_event_id, e.summary, e.imported_at])).toEqual([["a", "Event a", NOW.toISOString()]]);
    expect(state.saved).toEqual([NOW]);
    // A day either side of the event, not the whole 180-day window.
    expect(reprocess).toHaveBeenCalledWith({ from: new Date("2026-10-30T19:00:00Z"), to: new Date("2026-11-01T20:00:00Z") });
  });

  it("updates an existing event in place, keeping its Hub id, and reprocesses the old dates too when it moved", async () => {
    dataset.calendarEvents.push({
      id: "gcal_AAAAAAAAAAA1", google_event_id: "a", summary: "Old", description: null, location: null,
      start_time: "2026-11-10T15:00:00Z", end_time: "2026-11-10T16:00:00Z", creator_email: null, creator_name: null,
      organizer_email: null, organizer_name: null, raw_data: {}, imported_at: null,
    } as never);
    const { run, reprocess } = setup([timed("a", "2026-10-31T19:00:00Z", "2026-10-31T20:00:00Z", { summary: "Heads Down" })]);
    await run();

    expect(dataset.calendarEvents).toHaveLength(1);
    expect(dataset.calendarEvents[0]).toMatchObject({ id: "gcal_AAAAAAAAAAA1", summary: "Heads Down" });
    expect(reprocess).toHaveBeenCalledWith({ from: new Date("2026-10-30T19:00:00Z"), to: new Date("2026-11-11T16:00:00Z") });
  });

  it("removes cancelled events, and ones that became all-day, and reprocesses the dates they had", async () => {
    for (const id of ["gone", "allday"]) {
      dataset.calendarEvents.push({
        id: `gcal_${id}`, google_event_id: id, summary: id, description: null, location: null,
        start_time: "2026-11-03T15:00:00Z", end_time: "2026-11-03T16:00:00Z", creator_email: null, creator_name: null,
        organizer_email: null, organizer_name: null, raw_data: {}, imported_at: null,
      } as never);
    }
    const { run, reprocess } = setup([{ id: "gone", status: "cancelled" }, { id: "allday", start: { date: "2026-11-03" }, end: { date: "2026-11-04" } }]);
    const result = await run();

    expect(dataset.calendarEvents).toEqual([]);
    expect(result).toMatchObject({ runs: [{ changed: 0, deleted: 2 }] });
    expect(reprocess).toHaveBeenCalledWith({ from: new Date("2026-11-02T15:00:00Z"), to: new Date("2026-11-04T16:00:00Z") });
  });

  it("does nothing, and reprocesses nothing, when no events changed", async () => {
    const { run, reprocess } = setup([]);
    expect(await run()).toMatchObject({ runs: [{ mode: "incremental", changed: 0, deleted: 0, range: null }] });
    expect(reprocess).not.toHaveBeenCalled();
    expect(state.saved).toEqual([NOW]);
  });

  it.each([["there is no watermark yet", null], ["the watermark is older than two days", new Date("2026-10-25T12:00:00Z")]])(
    "falls back to the full sync when %s",
    async (_label, syncedThrough) => {
      state.syncedThrough = syncedThrough;
      const { run, client, fullSync } = setup();
      expect(await run()).toMatchObject({ runs: [{ mode: "full" }] });
      expect(fullSync).toHaveBeenCalledOnce();
      expect(client.listChangedEvents).not.toHaveBeenCalled();
      expect(state.saved).toEqual([NOW]);
    }
  );

  it("does nothing when another sync holds the claim (it was told to run once more)", async () => {
    state.claims = [false];
    const { run, client, fullSync } = setup();
    expect(await run()).toEqual({ status: "queued" });
    expect(client.listChangedEvents).not.toHaveBeenCalled();
    expect(fullSync).not.toHaveBeenCalled();
    expect(state.saved).toEqual([]);
  });

  it("runs again when a notification arrived meanwhile, picking up from where the last run began", async () => {
    state.releases = [false, true];
    const { run, client } = setup();
    const result = await run();
    expect(client.listChangedEvents).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "done", runs: [{ mode: "incremental" }, { mode: "incremental" }] });
  });

  it("keeps the watermark where it was and lets go of the claim when the fetch fails", async () => {
    const { run, client } = setup();
    client.listChangedEvents.mockRejectedValueOnce(new Error("quota"));
    await expect(run()).rejects.toThrow("quota");
    expect(state.saved).toEqual([]);
    expect(state.abandoned).toBe(1);
  });
});

describe("coversSyncWindow", () => {
  const { timeMin, timeMax } = syncWindow(NOW);
  it("is true for a sync over the whole watched window, false for a narrower admin range", () => {
    expect(coversSyncWindow(new Date(timeMin), new Date(timeMax), NOW)).toBe(true);
    expect(coversSyncWindow(new Date("2026-10-01T00:00:00Z"), new Date(timeMax), NOW)).toBe(false);
    expect(coversSyncWindow(new Date(timeMin), new Date("2026-12-01T00:00:00Z"), NOW)).toBe(false);
  });

  it("allows an hour of drift, since the import counts 90 calendar days and a DST change makes one 23 or 25 hours", () => {
    const hour = 60 * 60 * 1000;
    expect(coversSyncWindow(new Date(new Date(timeMin).getTime() + hour), new Date(new Date(timeMax).getTime() - hour), NOW)).toBe(true);
    expect(coversSyncWindow(new Date(new Date(timeMin).getTime() + 3 * hour), new Date(timeMax), NOW)).toBe(false);
  });
});
