import { describe, expect, it } from "vitest";
import { careExcludedMemberIds, loadCareResults } from "@/lib/care-results";
import type { CareTimes } from "@/lib/care";
import { SupabaseActivityRepository } from "@/lib/data/activities";
import type { Db } from "@/lib/data/db";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { SupabaseMemberInteractionRepository } from "@/lib/data/member-interactions";
import { createInMemoryRepos } from "@/lib/data/repos";
import { failingDb } from "@/tests/helpers/people-fixtures";

const [ADA, BO, CY, DEE, ELI] = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2", "mbr_AAAAAAAAAAA3", "mbr_AAAAAAAAAAA4", "mbr_AAAAAAAAAAA5"];
const MANAGER_USER = "11111111-1111-4111-8111-111111111111";

const engagement: Pick<{ member_id: string; opened_by: string | null }, "member_id" | "opened_by"> & CareTimes = {
  member_id: ADA,
  opened_by: MANAGER_USER,
  opened_at: "2026-03-01T15:00:00.000Z",
  period_ends_on: "2026-03-31",
  closed_at: null,
  last_staff_message_at: null,
  last_member_message_at: null,
};

const member = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, email: `${name.toLowerCase()}@example.test`, ...extra });
const staffRow = (id: string, memberId: string | null) =>
  ({ id, name: "Staff Example", email: `${id}@example.test`, role: "staff", member_id: memberId, user_id: null, hired_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }) as never;
const activity = (type: string, at: string, related: string, source = type.startsWith("slack") ? "slack" : "prickle_attendance") => ({
  id: `act_${related}`,
  member_id: ADA,
  activity_type: type,
  activity_category: "event",
  title: "x",
  occurred_at: at,
  source,
  related_id: related,
  description: null,
  engagement_value: null,
  actor_kind: "member",
  actor_user_id: null,
  acting_as_member_id: null,
  duration_minutes: null,
  prickle_id: null,
  data: null,
  created_at: at,
});
const interaction = (a: string, b: string, at: string, n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  member_a: a,
  member_b: b,
  kind: "dm",
  channel_id: null,
  message_id: null,
  occurred_at: at,
  visibility: "private",
});

function seed() {
  const data = new InMemoryDataset({
    members: [member(ADA, "Ada"), member(BO, "Bo"), member(CY, "Cy"), member(DEE, "Dee", { userId: MANAGER_USER }), member(ELI, "Eli")],
  });
  data.staff = [staffRow("staff_1", CY), staffRow("staff_2", null)];
  data.activities.push(
    activity("prickle_attended", "2026-02-20T15:00:00Z", "prkl_AAAAAAAAAAA1"), // before
    activity("prickle_attended", "2026-03-10T15:00:00Z", "prkl_AAAAAAAAAAA2"), // during
    activity("slack_message", "2026-03-12T15:00:00Z", "m1"), // during
    activity("slack_thread_reply", "2026-05-10T15:00:00Z", "m2"), // after
    activity("prickle_attended", "2026-05-12T15:00:00Z", "prkl_AAAAAAAAAAA3") // after
  );
  data.memberInteractions.push(
    interaction(ADA, BO, "2026-02-15T15:00:00Z", 1), // before: Bo
    interaction(CY, ADA, "2026-03-05T15:00:00Z", 2), // during: Cy is staff
    interaction(ADA, DEE, "2026-03-06T15:00:00Z", 3), // during: Dee opened it
    interaction(ADA, ELI, "2026-03-07T15:00:00Z", 4), // during: Eli
    interaction(ELI, ADA, "2026-03-08T15:00:00Z", 5), // during: Eli again
    interaction(ADA, BO, "2026-05-10T15:00:00Z", 6) // after: Bo
  );
  return createInMemoryRepos(data);
}

describe("careExcludedMemberIds", () => {
  it("excludes every member who is staff and the person who opened it, even when they are not in the staff table", async () => {
    expect(await careExcludedMemberIds(seed(), MANAGER_USER)).toEqual(new Set([CY, DEE]));
  });

  it("excludes only staff when nobody opened it (an import), and ignores a staff row with no member", async () => {
    expect(await careExcludedMemberIds(seed(), null)).toEqual(new Set([CY]));
  });

  it("copes with an opener who has no member record", async () => {
    expect(await careExcludedMemberIds(seed(), "22222222-2222-4222-8222-222222222222")).toEqual(new Set([CY]));
  });
});

describe("loadCareResults", () => {
  it("counts each window from the member's activity, leaving staff and the opener out of the people they connected with", async () => {
    const results = await loadCareResults(seed(), engagement, new Date("2027-01-01T00:00:00Z"));

    expect(results.before.counts).toEqual({ pricklesAttended: 1, slackMessages: 0, firstPrickle: true, firstSlackPost: false, peopleConnected: 1 });
    expect(results.during.counts).toEqual({ pricklesAttended: 1, slackMessages: 1, firstPrickle: false, firstSlackPost: true, peopleConnected: 1 });
    expect(results.after.counts).toEqual({ pricklesAttended: 1, slackMessages: 1, firstPrickle: false, firstSlackPost: false, peopleConnected: 1 });
    expect(results.after.window.state).toBe("complete");
  });

  it("does not count the after window until it has passed, and counts during so far", async () => {
    const results = await loadCareResults(seed(), engagement, new Date("2026-03-10T00:00:00Z"));

    expect(results.after).toMatchObject({ counts: null, window: { state: "not_yet" } });
    expect(results.during.window.state).toBe("so_far");
    expect(results.during.counts?.pricklesAttended).toBe(0); // the prickle on the 10th at 15:00 has not happened yet
  });

  it("leaves a firsts flag off when the first activity is outside the window", async () => {
    const data = seed();
    const repos = data;
    const results = await loadCareResults(repos, { ...engagement, opened_at: "2026-04-01T15:00:00.000Z", period_ends_on: "2026-04-30" }, new Date("2027-01-01T00:00:00Z"));
    expect(results.before.counts).toMatchObject({ firstPrickle: false }); // the first prickle was before the window began
  });
});

describe("the Supabase reads behind it", () => {
  type Call = { method: string; args: unknown[] };
  function scripted(rows: unknown[]) {
    const calls: Call[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "or", "gte", "lt", "order", "range", "limit"]) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        return chain;
      };
    }
    const answer = { data: rows, error: null };
    chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    return { db: { from: () => chain } as unknown as Db, calls };
  }

  it("asks for a member's interactions in either direction, from the start up to the end, in a stable order", async () => {
    const { db, calls } = scripted([
      { member_a: ADA, member_b: BO },
      { member_a: CY, member_b: ADA },
    ]);
    expect(await new SupabaseMemberInteractionRepository(db).counterpartsBetween(ADA, "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z")).toEqual(new Set([BO, CY]));
    expect(calls).toContainEqual({ method: "or", args: [`member_a.eq.${ADA},member_b.eq.${ADA}`] });
    expect(calls).toContainEqual({ method: "gte", args: ["occurred_at", "2026-03-01T00:00:00Z"] });
    expect(calls).toContainEqual({ method: "lt", args: ["occurred_at", "2026-04-01T00:00:00Z"] });
    expect(calls).toContainEqual({ method: "order", args: ["id"] });
  });

  it("counts a prickle once however many rows it has, and an attendance with no prickle id once each", async () => {
    const { db, calls } = scripted([
      { activity_type: "prickle_attended", related_id: "prkl_AAAAAAAAAAA1", prickle_id: null },
      { activity_type: "prickle_attended", related_id: "prkl_AAAAAAAAAAA1", prickle_id: null },
      { activity_type: "prickle_attended", related_id: null, prickle_id: "prkl_AAAAAAAAAAA2" },
      { activity_type: "prickle_attended", related_id: null, prickle_id: null },
      { activity_type: "prickle_attended", related_id: null, prickle_id: null },
      { activity_type: "slack_message", related_id: "m1", prickle_id: null },
    ]);
    expect(await new SupabaseActivityRepository(db).countsBetween(ADA, "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z")).toEqual({ pricklesAttended: 4, slackMessages: 1 });
    expect(calls).toContainEqual({ method: "gte", args: ["occurred_at", "2026-03-01T00:00:00Z"] });
    expect(calls).toContainEqual({ method: "lt", args: ["occurred_at", "2026-04-01T00:00:00Z"] });
  });

  it("asks for the earliest prickle and the earliest Slack post", async () => {
    const { db, calls } = scripted([{ occurred_at: "2026-01-01T00:00:00Z" }]);
    expect(await new SupabaseActivityRepository(db).firsts(ADA)).toEqual({ firstPrickleAt: "2026-01-01T00:00:00Z", firstSlackPostAt: "2026-01-01T00:00:00Z" });
    expect(calls).toContainEqual({ method: "order", args: ["occurred_at", { ascending: true }] });
    expect(calls).toContainEqual({ method: "in", args: ["activity_type", ["prickle_attended"]] });
    expect(calls).toContainEqual({ method: "in", args: ["activity_type", ["slack_message", "slack_thread_reply"]] });
  });

  it("answers null when a member has no such activity", async () => {
    expect(await new SupabaseActivityRepository(scripted([]).db).firsts(ADA)).toEqual({ firstPrickleAt: null, firstSlackPostAt: null });
  });

  it("throws the database's error instead of reading as no one", async () => {
    await expect(new SupabaseMemberInteractionRepository(failingDb()).counterpartsBetween(ADA, "a", "b")).rejects.toThrow("database is down");
    await expect(new SupabaseActivityRepository(failingDb()).countsBetween(ADA, "a", "b")).rejects.toThrow("database is down");
    await expect(new SupabaseActivityRepository(failingDb()).firsts(ADA)).rejects.toThrow("database is down");
  });
});
