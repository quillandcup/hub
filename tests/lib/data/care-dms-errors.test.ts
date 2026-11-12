import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCareTrackedDmRepository } from "@/lib/data/care-dms";
import { failingDb } from "@/tests/helpers/people-fixtures";

const [user, channel, member, at] = ["11111111-1111-4111-8111-111111111111", "D0EXAMPLE001", "mbr_AAAAAAAAAAA1", "2026-03-01T15:00:00.000Z"];

/** A client that records each query's calls and answers the n-th `from()` with the n-th prepared answer. */
function scriptedDb(answers: { data: unknown; error: { message: string; code?: string } | null }[]) {
  const queries: { table: string; calls: { method: string; args: unknown[] }[] }[] = [];
  const db = {
    from(table: string) {
      const answer = answers[queries.length] ?? { data: null, error: null };
      const query = { table, calls: [] as { method: string; args: unknown[] }[] };
      queries.push(query);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "eq", "is", "order", "range"]) {
        chain[m] = (...args: unknown[]) => {
          query.calls.push({ method: m, args });
          return chain;
        };
      }
      chain.single = async () => answer;
      chain.maybeSingle = async () => answer;
      chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
      return chain;
    },
  } as unknown as Db;
  return { db, queries };
}

const row = { id: "caredm_AAAAAAAAAAA1", tracked_by: user, slack_channel_id: channel, member_id: member, created_at: at, deleted_at: null };

describe("SupabaseCareTrackedDmRepository database errors", () => {
  const repo = new SupabaseCareTrackedDmRepository(failingDb());

  it.each([
    ["forUser", () => repo.forUser(user)],
    ["allLive", () => repo.allLive()],
    ["forChannel", () => repo.forChannel(channel)],
    ["track", () => repo.track({ trackedBy: user, channelId: channel, memberId: member })],
    ["untrack", () => repo.untrack(user, channel, at)],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });
});

describe("SupabaseCareTrackedDmRepository queries", () => {
  it("reads one user's live rows by the tracking user", async () => {
    const q = scriptedDb([{ data: [row], error: null }]);
    expect(await new SupabaseCareTrackedDmRepository(q.db).forUser(user)).toEqual([{ id: row.id, trackedBy: user, channelId: channel, memberId: member, createdAt: at }]);
    expect(q.queries[0].calls).toContainEqual({ method: "eq", args: ["tracked_by", user] });
    expect(q.queries[0].calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("answers the existing row when the DM is already tracked (a unique violation)", async () => {
    const q = scriptedDb([
      { data: null, error: { message: "duplicate key", code: "23505" } },
      { data: row, error: null },
    ]);
    const result = await new SupabaseCareTrackedDmRepository(q.db).track({ trackedBy: user, channelId: channel, memberId: member });
    expect(result).toEqual({ created: false, dm: { id: row.id, trackedBy: user, channelId: channel, memberId: member, createdAt: at } });
    expect(q.queries[1].calls).toContainEqual({ method: "eq", args: ["slack_channel_id", channel] });
  });

  it("throws the violation when the row is gone again before the lookup", async () => {
    const q = scriptedDb([
      { data: null, error: { message: "duplicate key", code: "23505" } },
      { data: null, error: null },
    ]);
    await expect(new SupabaseCareTrackedDmRepository(q.db).track({ trackedBy: user, channelId: channel, memberId: member })).rejects.toThrow("duplicate key");
  });

  it("throws the lookup's own error after a unique violation", async () => {
    const q = scriptedDb([
      { data: null, error: { message: "duplicate key", code: "23505" } },
      { data: null, error: { message: "lookup failed" } },
    ]);
    await expect(new SupabaseCareTrackedDmRepository(q.db).track({ trackedBy: user, channelId: channel, memberId: member })).rejects.toThrow("lookup failed");
  });

  it("soft deletes only the caller's live row", async () => {
    const q = scriptedDb([{ data: { id: row.id }, error: null }]);
    expect(await new SupabaseCareTrackedDmRepository(q.db).untrack(user, channel, at)).toBe(true);
    expect(q.queries[0].calls[0]).toEqual({ method: "update", args: [{ deleted_at: at }] });
    expect(q.queries[0].calls).toContainEqual({ method: "eq", args: ["tracked_by", user] });
    expect(await new SupabaseCareTrackedDmRepository(scriptedDb([{ data: null, error: null }]).db).untrack(user, channel, at)).toBe(false);
  });
});
