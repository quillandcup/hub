import { describe, it, expect } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";
import {
  loadAttendedMemberIds,
  loadIntroChannelId,
  loadIntroducedMemberIds,
  loadLastAttendanceByMember,
} from "@/lib/newcomer-signals";
import { SLACK_INTRO_CHANNEL } from "@/lib/config";
import { InMemoryAttendanceRepository } from "@/lib/data/attendance";

const eqs = (query: FakeQuery) => query.calls.filter((c) => c.method === "eq").map((c) => c.args);
const inIds = (query: FakeQuery) => query.calls.find((c) => c.method === "in")?.args[1] as string[] | undefined;

/** Rows whose member_id is in the query's `.in("member_id", ids)`. */
const forMembers = <T extends { member_id: string }>(rows: T[]) => (query: FakeQuery) => {
  const ids = inIds(query);
  return { data: rows.filter((r) => !ids || ids.includes(r.member_id)) };
};

describe("loadIntroducedMemberIds", () => {
  it("returns members with a top-level Slack message in the intro channel", async () => {
    const fake = createFakeSupabase({ member_activities: forMembers([{ member_id: "m1" }, { member_id: "m1" }, { member_id: "m3" }]) });

    expect(await loadIntroducedMemberIds(fake, ["m1", "m2"])).toEqual(new Set(["m1"]));
  });

  it("asks only for Slack messages (not replies) in the intro channel", async () => {
    const fake = createFakeSupabase({});
    await loadIntroducedMemberIds(fake, ["m1"]);

    const query = fake.queries.find((q) => q.table === "member_activities")!;
    expect(eqs(query)).toEqual(
      expect.arrayContaining([
        ["source", "slack"],
        ["activity_type", "slack_message"],
        ["data->>channel_name", SLACK_INTRO_CHANNEL],
      ])
    );
  });

  it("looks members up in chunks, so a long list doesn't make an over-long URL", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `m${i}`);
    const fake = createFakeSupabase({ member_activities: forMembers([{ member_id: "m449" }]) });

    expect(await loadIntroducedMemberIds(fake, ids)).toEqual(new Set(["m449"]));
    expect(fake.queries.filter((q) => q.table === "member_activities").map((q) => inIds(q)!.length)).toEqual([200, 200, 50]);
  });

  it("returns nothing, without querying, for no members", async () => {
    const fake = createFakeSupabase({});
    expect(await loadIntroducedMemberIds(fake, [])).toEqual(new Set());
    expect(fake.queries).toEqual([]);
  });

  it("pages through more than a thousand rows", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ member_id: `m${i}` }));
    const fake = createFakeSupabase({ member_activities: { data: rows } });

    expect((await loadIntroducedMemberIds(fake, ["m1"])).size).toBe(1500);
  });
});

const attended = (rows: { memberId: string; joinTime: string }[]) =>
  new InMemoryAttendanceRepository(rows.map((r, i) => ({ id: `att_${i}`, prickleId: "prkl_AAAAAAAAAAA1", leaveTime: r.joinTime, ...r })));

describe("loadAttendedMemberIds", () => {
  it("returns members with any prickle attendance", async () => {
    const repo = attended([
      { memberId: "m2", joinTime: "2026-09-01T15:00:00Z" },
      { memberId: "m2", joinTime: "2026-09-02T15:00:00Z" },
    ]);

    expect(await loadAttendedMemberIds(repo, ["m1", "m2"])).toEqual(new Set(["m2"]));
  });
});

describe("loadLastAttendanceByMember", () => {
  it("keeps each member's latest join across their attendance rows", async () => {
    const repo = attended([
      { memberId: "m1", joinTime: "2026-09-01T15:00:00Z" },
      { memberId: "m1", joinTime: "2026-10-05T15:00:00Z" },
      { memberId: "m1", joinTime: "2026-09-20T15:00:00Z" },
      { memberId: "m2", joinTime: "2026-08-01T15:00:00Z" },
    ]);

    const last = await loadLastAttendanceByMember(repo, ["m1", "m2", "m3"]);

    expect(last.get("m1")).toEqual(new Date("2026-10-05T15:00:00Z"));
    expect(last.get("m2")).toEqual(new Date("2026-08-01T15:00:00Z"));
    expect(last.has("m3")).toBe(false);
  });
});

describe("loadIntroChannelId", () => {
  it("reads the intro channel's Slack id from bronze", async () => {
    const fake = createFakeSupabase({ "bronze.slack_channels": { data: [{ channel_id: "C123" }] } });

    expect(await loadIntroChannelId(fake)).toBe("C123");
    expect(eqs(fake.queries[0])).toContainEqual(["name", SLACK_INTRO_CHANNEL]);
  });

  it("is null when the workspace has no such channel", async () => {
    expect(await loadIntroChannelId(createFakeSupabase({}))).toBeNull();
  });
});
