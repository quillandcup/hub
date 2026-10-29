import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  abandonCalendarSync,
  CLAIM_STALE_MS,
  claimCalendarSync,
  releaseCalendarSync,
  saveSyncedThrough,
} from "@/lib/google-calendar/sync-state";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

// The claim protocol is single conditional UPDATEs, so its guarantees are the database's: run it against Postgres.
const db = getTestSupabaseAdminClient() as unknown as Parameters<typeof claimCalendarSync>[0];
const CAL = `sync-state-${Date.now()}@example.test`;
const NOW = new Date("2026-10-28T12:00:00Z");
const row = async () => (await db.from("calendar_sync_state").select("*").eq("calendar_id", CAL).single()).data!;
const clear = async () => void (await db.from("calendar_sync_state").delete().eq("calendar_id", CAL));

describe("calendar sync claim", () => {
  beforeEach(clear);
  afterAll(clear);

  it("gives the claim to one caller and notes a rerun for the others", async () => {
    expect(await claimCalendarSync(db, CAL, NOW)).toEqual({ claimed: true, syncedThrough: null });
    expect(await claimCalendarSync(db, CAL, NOW)).toEqual({ claimed: false });
    expect(await claimCalendarSync(db, CAL, NOW)).toEqual({ claimed: false });
    const held = await row();
    expect(new Date(held.running_since!).toISOString()).toBe(NOW.toISOString());
    expect(held.rerun_requested).toBe(true);
  });

  it("lets only one of simultaneous callers win", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => claimCalendarSync(db, CAL, NOW)));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
  });

  it("releases when nobody asked for a rerun; otherwise keeps the claim and clears the request", async () => {
    await claimCalendarSync(db, CAL, NOW);
    expect(await releaseCalendarSync(db, CAL, NOW)).toBe(true);
    expect((await row()).running_since).toBeNull();

    await claimCalendarSync(db, CAL, NOW);
    await claimCalendarSync(db, CAL, NOW); // a notification meanwhile
    expect(await releaseCalendarSync(db, CAL, NOW)).toBe(false);
    expect(await row()).toMatchObject({ rerun_requested: false });
    expect((await row()).running_since).not.toBeNull();
    expect(await releaseCalendarSync(db, CAL, NOW)).toBe(true);
  });

  it("takes over a claim that has been held longer than the stale limit, and not before", async () => {
    await claimCalendarSync(db, CAL, NOW);
    const almost = new Date(NOW.getTime() + CLAIM_STALE_MS - 1000);
    expect(await claimCalendarSync(db, CAL, almost)).toEqual({ claimed: false });
    const stale = new Date(NOW.getTime() + CLAIM_STALE_MS + 1000);
    expect(await claimCalendarSync(db, CAL, stale)).toMatchObject({ claimed: true });
  });

  it("hands the watermark to whoever claims next, and abandoning leaves it alone", async () => {
    await claimCalendarSync(db, CAL, NOW);
    await saveSyncedThrough(db, CAL, NOW);
    await abandonCalendarSync(db, CAL);
    expect((await row()).running_since).toBeNull();

    const next = await claimCalendarSync(db, CAL, new Date(NOW.getTime() + 60_000));
    expect(next).toMatchObject({ claimed: true });
    expect((next as { syncedThrough: Date }).syncedThrough.toISOString()).toBe(NOW.toISOString());
  });

  it("saves a watermark for a calendar with no row yet", async () => {
    await saveSyncedThrough(db, CAL, NOW);
    expect(new Date((await row()).synced_through!).toISOString()).toBe(NOW.toISOString());
  });
});
