import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseActivityRepository } from "@/lib/data/activities";
import { failingDb } from "@/tests/helpers/people-fixtures";

const NOW = new Date("2026-03-20T15:00:00.000Z");
const ada = "mbr_AAAAAAAAAAA1";

describe("SupabaseActivityRepository database errors (participation and score windows)", () => {
  const repo = new SupabaseActivityRepository(failingDb());

  it.each([
    ["lastParticipation", () => repo.lastParticipation([ada], NOW)],
    ["engagementRowsForWindows", () => repo.engagementRowsForWindows([{ memberId: ada, endIso: NOW.toISOString() }])],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });
});

describe("SupabaseActivityRepository lastParticipation", () => {
  /** A client that records the filters of each query and answers the n-th with the n-th prepared rows. */
  function recording(answers: unknown[][]) {
    const queries: { method: string; args: unknown[] }[][] = [];
    const db = {
      from() {
        const calls: { method: string; args: unknown[] }[] = [];
        queries.push(calls);
        const answer = { data: answers[queries.length - 1] ?? [], error: null };
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "in", "eq", "lte", "gte", "order"]) chain[m] = (...args: unknown[]) => (calls.push({ method: m, args }), chain);
        chain.range = (...args: unknown[]) => (calls.push({ method: "range", args }), Promise.resolve(answer));
        return chain;
      },
    } as unknown as Db;
    return { db, queries };
  }

  it("looks back a week, then a month and so on, and only for the members not found yet", async () => {
    const bo = "mbr_AAAAAAAAAAA2";
    const { db, queries } = recording([
      [{ member_id: ada, activity_type: "prickle_attended", actor_kind: "member", occurred_at: "2026-03-18T10:00:00.000Z" }], // a week: Ada
      [{ member_id: bo, activity_type: "slack_message", actor_kind: "member", occurred_at: "2026-03-01T10:00:00.000Z" }], // a month: Bo
    ]);

    const found = await new SupabaseActivityRepository(db).lastParticipation([ada, bo, ada], NOW);

    expect([...found.keys()].sort()).toEqual([ada, bo]);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContainEqual({ method: "in", args: ["member_id", [ada, bo]] });
    expect(queries[0]).toContainEqual({ method: "gte", args: ["occurred_at", "2026-03-13T15:00:00.000Z"] });
    expect(queries[0]).toContainEqual({ method: "eq", args: ["actor_kind", "member"] });
    expect(queries[0]).toContainEqual({ method: "lte", args: ["occurred_at", NOW.toISOString()] });
    expect(queries[1]).toContainEqual({ method: "in", args: ["member_id", [bo]] });
    expect(queries[1]).toContainEqual({ method: "gte", args: ["occurred_at", "2026-02-18T15:00:00.000Z"] });
  });

  it("goes on to all time for a member nothing was found for, then stops", async () => {
    const { db, queries } = recording([]);
    const found = await new SupabaseActivityRepository(db).lastParticipation([ada], NOW);
    expect(found.size).toBe(0);
    expect(queries).toHaveLength(5);
    expect(queries[4].some((c) => c.method === "gte")).toBe(false);
  });

  it("asks nothing for no members", async () => {
    const { db, queries } = recording([]);
    expect((await new SupabaseActivityRepository(db).lastParticipation([], NOW)).size).toBe(0);
    expect(queries).toHaveLength(0);
  });
});
