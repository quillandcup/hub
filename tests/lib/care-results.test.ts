import { describe, expect, it } from "vitest";
import { careExcludedMemberIds, loadCareResults } from "@/lib/care-results";
import type { CareTimes } from "@/lib/care";
import { SupabaseActivityRepository } from "@/lib/data/activities";
import type { Db } from "@/lib/data/db";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { SupabaseMemberInteractionRepository } from "@/lib/data/member-interactions";
import { createInMemoryRepos } from "@/lib/data/repos";
import { parseDateOnly } from "@/lib/member-tenure";
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

const program = (id: string, name: string) => ({ id, name, includes_membership: false }) as never;
const cohort = (id: string, programId: string, startsAt: string, expiresAt: string) => ({ id, program_id: programId, starts_at: startsAt, expires_at: expiresAt }) as never;
const enrollment = (id: string, cohortId: string) => ({ id, member_id: ADA, cohort_id: cohortId, created_at: "2026-01-01T00:00:00Z" }) as never;
const hiatus = (id: string, start: string, end: string | null) =>
  ({ id, member_id: ADA, start_date: start, end_date: end, reason: null, notes: null, created_at: null, created_by: null, updated_at: "2026-01-01T00:00:00Z" }) as never;

function seed(options: { hiatusFrom?: string | null; hiatusTo?: string | null; programEnds?: string } = {}) {
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
  // Ada is a member through a program that runs to the end of the year (or `programEnds`), goes on hiatus from mid April (or
  // `hiatusFrom`, none for null) with no end, and a second program starts inside the "during" window.
  data.programs = [program("prog_AAAAAAAAAAA1", "Example Program"), program("prog_AAAAAAAAAAA2", "Second Program")];
  data.programCohorts = [
    cohort("coh_AAAAAAAAAAA1", "prog_AAAAAAAAAAA1", "2026-01-01", options.programEnds ?? "2026-12-31"),
    cohort("coh_AAAAAAAAAAA2", "prog_AAAAAAAAAAA2", "2026-03-15", "2026-03-31"),
  ];
  data.programEnrollments = [enrollment("enr_AAAAAAAAAAA1", "coh_AAAAAAAAAAA1"), enrollment("enr_AAAAAAAAAAA2", "coh_AAAAAAAAAAA2")];
  data.memberHiatuses = options.hiatusFrom === null ? [] : [hiatus("hia_AAAAAAAAAAA1", options.hiatusFrom ?? "2026-04-15", options.hiatusTo ?? null)];
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
  const LATER = new Date("2027-01-01T00:00:00Z");
  const CHECKPOINTS = [60, 90, 180];
  const load = (repos: ReturnType<typeof seed>, now = LATER, over: Partial<typeof engagement> = {}) =>
    loadCareResults(repos, repos, { ...engagement, ...over }, now, undefined, CHECKPOINTS);

  it("counts each window from the member's activity, leaving staff and the opener out of the people they connected with", async () => {
    const { windows } = await load(seed());

    expect(windows.before.counts).toMatchObject({ pricklesAttended: 1, slackMessages: 0, firstPrickle: true, firstSlackPost: false, peopleConnected: 1 });
    expect(windows.during.counts).toMatchObject({ pricklesAttended: 1, slackMessages: 1, firstPrickle: false, firstSlackPost: true, peopleConnected: 1 });
    expect(windows.after.counts).toMatchObject({ pricklesAttended: 1, slackMessages: 1, firstPrickle: false, firstSlackPost: false, peopleConnected: 1 });
    expect(windows.after.window.state).toBe("complete");
  });

  it("lists the programs whose start date falls inside each window, with how long each is", async () => {
    const { windows } = await load(seed());

    expect(windows.before.counts?.programsStarted).toEqual([]);
    expect(windows.during.counts?.programsStarted).toEqual(["Second Program, 16 days"]);
    expect(windows.after.counts?.programsStarted).toEqual([]);
  });

  it("reads membership at each checkpoint as active, on hiatus or cancelled, three distinct states, with the program held", async () => {
    // Hiatus from mid April with no end: on hiatus at every checkpoint, which is not the same as gone.
    const { retention } = await load(seed());

    expect(retention.checkpoints.map((c) => [c.days, c.state, c.membership])).toEqual([
      [60, "complete", "on_hiatus"],
      [90, "complete", "on_hiatus"],
      [180, "complete", "on_hiatus"],
    ]);
    expect(retention.checkpoints[0].programs).toEqual(["Example Program, 12 months"]);
    expect(retention.checkpoints[0].at).toBe("2026-05-31T04:00:00.000Z");
  });

  it("says cancelled once the membership ended, and active while it ran", async () => {
    const { retention } = await load(seed({ hiatusFrom: null, programEnds: "2026-06-15" }));

    expect(retention.checkpoints.map((c) => c.membership)).toEqual(["member", "not_a_member", "not_a_member"]); // day 60 is May 31; the program ran to Jun 15
    expect(retention.checkpoints[0].programs).toEqual(["Example Program, 5 months"]);
    expect(retention.checkpoints[1].programs).toEqual([]); // no longer held
    expect(retention.firstLapse).toMatchObject({ status: "cancelled" });
  });

  it("shows the first hiatus even though they came back, with how many days after it started", async () => {
    const { retention } = await load(seed({ hiatusFrom: "2026-03-20", hiatusTo: "2026-04-10" }));

    expect(retention.checkpoints.map((c) => c.membership)).toEqual(["member", "member", "member"]); // back and active at every checkpoint
    expect(retention.firstLapse?.status).toBe("on_hiatus");
    // The hiatus began at the start of Mar 20 (parseDateOnly: the machine's midnight), after it opened on Mar 1 at 15:00 UTC.
    expect(retention.firstLapse?.daysAfterStart).toBe(Math.floor((parseDateOnly("2026-03-20").getTime() - Date.parse(engagement.opened_at)) / 86_400_000));
    expect(retention.firstLapse?.at).toBe(parseDateOnly("2026-03-20").toISOString());
  });

  it("has no first lapse when they have not gone on hiatus or left, and none before it began", async () => {
    expect((await load(seed({ hiatusFrom: null, programEnds: "2027-12-31" }))).retention.firstLapse).toBeNull();
    expect((await load(seed(), new Date("2026-04-01T00:00:00Z"))).retention.firstLapse).toBeNull(); // the hiatus is still in the future
  });

  it("says not yet for a checkpoint that has not passed, without reading membership for it", async () => {
    const { retention } = await load(seed({ hiatusFrom: null }), new Date("2026-06-15T00:00:00Z"));

    expect(retention.checkpoints.map((c) => [c.days, c.state])).toEqual([[60, "complete"], [90, "not_yet"], [180, "not_yet"]]);
    expect(retention.checkpoints[1]).toMatchObject({ membership: null, programs: null });
  });

  it("uses the configured checkpoints when none are given", async () => {
    const repos = seed();
    const { retention } = await loadCareResults(repos, repos, engagement, LATER);
    expect(retention.checkpoints.length).toBeGreaterThan(0);
  });

  it("reads a member who does not exist as cancelled with nothing held", async () => {
    const { retention, windows } = await load(seed(), LATER, { member_id: "mbr_ZZZZZZZZZZZZ" });
    expect(retention.checkpoints[0]).toMatchObject({ membership: "not_a_member", programs: [] });
    expect(retention.firstLapse).toBeNull();
    expect(windows.before.counts).toMatchObject({ programsStarted: [] });
  });

  it("does not count the after window until it has passed, and counts during so far", async () => {
    const { windows } = await load(seed(), new Date("2026-03-10T00:00:00Z"));

    expect(windows.after).toMatchObject({ counts: null, window: { state: "not_yet" } });
    expect(windows.during.window.state).toBe("so_far");
    expect(windows.during.counts?.pricklesAttended).toBe(0); // the prickle on the 10th at 15:00 has not happened yet
    expect(windows.during.counts?.programsStarted).toEqual([]); // the second program starts on the 15th
  });

  it("leaves a firsts flag off when the first activity is outside the window", async () => {
    const { windows } = await load(seed(), LATER, { opened_at: "2026-04-01T15:00:00.000Z", period_ends_on: "2026-04-30" });
    expect(windows.before.counts).toMatchObject({ firstPrickle: false }); // the first prickle was before the window began
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
