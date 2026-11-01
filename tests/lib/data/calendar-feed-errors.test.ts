import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCalendarFeedRepository } from "@/lib/data/calendar-feed";
import { SupabaseCalendarSyncStateRepository } from "@/lib/data/calendar-sync-state";

/** A client whose every query answers with the given error: the repositories must throw it, not return an empty result. */
function failingDb(error: { message: string; code?: string }): Db {
  const answer = { data: null, error, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "is", "in", "or", "order", "range"]) chain[m] = () => chain;
  chain.single = async () => answer;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return { from: () => chain } as unknown as Db;
}

const [m, p] = ["mbr_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA1"];
const token = "0123456789abcdef0123456789abcdef";

describe("SupabaseCalendarFeedRepository database errors", () => {
  const repo = new SupabaseCalendarFeedRepository(failingDb({ message: "database is down" }));

  it.each([
    ["tokenOf", () => repo.tokenOf(m)],
    ["createTokenIfMissing", () => repo.createTokenIfMissing(m, token)],
    ["replaceToken", () => repo.replaceToken(m, token)],
    ["ownerOfToken", () => repo.ownerOfToken(token)],
    ["recordFirstFetch", () => repo.recordFirstFetch(token, "2097-01-01T00:00:00Z")],
    ["hasBeenFetched", () => repo.hasBeenFetched(m)],
    ["itemsOf", () => repo.itemsOf(m)],
    ["listedItemsOf", () => repo.listedItemsOf(m)],
    ["countItems", () => repo.countItems(m)],
    ["addItem", () => repo.addItem(m, null, { kind: "prickle", prickle_id: p })],
    ["removeItem", () => repo.removeItem(m, "item")],
    ["memberIdsWithPrickle", () => repo.memberIdsWithPrickle(p)],
    ["weeklySlotMembers", () => repo.weeklySlotMembers({ typeId: "ptyp_AAAAAAAAAAA1", dayOfWeek: 1, timezone: "America/New_York" })],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });

  it("never puts a token in the error", async () => {
    const error = await repo.ownerOfToken(token).catch((e) => e);
    expect(String(error.message)).not.toContain(token);
  });

  it("addItem reports a duplicate as already added, not as an error", async () => {
    const taken = new SupabaseCalendarFeedRepository(failingDb({ message: "duplicate key value", code: "23505" }));
    expect(await taken.addItem(m, null, { kind: "prickle", prickle_id: p })).toBe("exists");
  });
});

describe("SupabaseCalendarSyncStateRepository database errors", () => {
  const repo = new SupabaseCalendarSyncStateRepository(failingDb({ message: "database is down" }));
  const now = new Date("2026-10-28T12:00:00Z");

  it("names the table and the step in the message", async () => {
    await expect(repo.claim("cal", now)).rejects.toThrow("calendar_sync_state: create row: database is down");
    await expect(repo.release("cal", now)).rejects.toThrow("calendar_sync_state: release: database is down");
    await expect(repo.saveSyncedThrough("cal", now)).rejects.toThrow("calendar_sync_state: save watermark: database is down");
    await expect(repo.abandon("cal")).rejects.toThrow("database is down");
  });
});

/** A client that fails only the update with the given index (the claim protocol runs several in a row). */
function failingNthUpdate(failAt: number): Db {
  let updates = 0;
  const make = (): Record<string, unknown> => {
    let isUpdate = false;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "upsert", "eq", "or"]) chain[m] = () => chain;
    chain.update = () => {
      isUpdate = true;
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(isUpdate && ++updates === failAt ? { data: null, error: { message: "boom" } } : { data: [], error: null });
    return chain;
  };
  return { from: () => make() } as unknown as Db;
}

describe("SupabaseCalendarSyncStateRepository later steps", () => {
  const now = new Date("2026-10-28T12:00:00Z");

  it("names the step that failed", async () => {
    await expect(new SupabaseCalendarSyncStateRepository(failingNthUpdate(1)).claim("cal", now)).rejects.toThrow("calendar_sync_state: claim: boom");
    await expect(new SupabaseCalendarSyncStateRepository(failingNthUpdate(2)).claim("cal", now)).rejects.toThrow("calendar_sync_state: request rerun: boom");
    await expect(new SupabaseCalendarSyncStateRepository(failingNthUpdate(2)).release("cal", now)).rejects.toThrow("calendar_sync_state: clear rerun: boom");
  });
});
