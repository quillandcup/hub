import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";
import { useFakeClock } from "@/tests/helpers/fake-clock";
import { monthsBefore, rollUpAndPruneUsageEvents } from "@/lib/retention/usage-events";
import { RETENTION } from "@/lib/retention";
import { ORG_TIMEZONE } from "@/lib/config";

/**
 * The usage-event rollups against the real functions and tables, with a pinned clock: completed periods are
 * counted by dimension without any ids, events past 13 months go only once their day, week and month are rolled
 * up, and the app's own records and recent events stay.
 *
 * The database is shared with other tests, so the clock is pinned to the moment the test starts (nothing another
 * test made can be older than 13 months from it) and every assertion looks only at this test's own "rt_" events.
 */

const NOW = Date.now();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** The organisation's calendar date of an instant, and the Sunday and first of the month that contain it. */
function localDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
const sundayOf = (date: string) => addDays(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
const monthOf = (date: string) => `${date.slice(0, 8)}01`;
const nextMonth = (month: string) => {
  const d = new Date(`${month}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

describe("rollUpAndPruneUsageEvents (local database)", () => {
  const db = getTestSupabaseAdminClient() as unknown as SupabaseClient;
  const ts = Date.now();
  useFakeClock(() => NOW);
  let alice = "";
  let bob = "";

  // Recent and completed (past the two-day grace), too old to keep, and still inside the grace period.
  const recentAt = NOW - 5 * DAY;
  const recentDay = localDate(recentAt);
  const oldAt = monthsBefore(NOW, RETENTION.usageMonths + 1).getTime();
  const oldDay = localDate(oldAt);
  const todayAt = NOW - 12 * 3_600_000;

  const event = (user: string, name: string, occurredAt: number, over: Record<string, unknown> = {}) => ({
    user_id: user,
    message_id: crypto.randomUUID(),
    session_id: crypto.randomUUID(),
    event: name,
    properties: {},
    context: { route: "/dashboard", viewport: "lg", browser: "Chrome", browser_version: "126.0.0.0", os: "macOS", device_type: "desktop" },
    occurred_at: iso(occurredAt),
    source: "client",
    sudo: false,
    ...over,
  });

  const rollups = async (kind: string, start: string, ev: string) =>
    (await db.from("analytics_rollups").select("*").eq("period_kind", kind).eq("period_start", start).eq("event", ev)).data ?? [];
  const cell = (rows: { dimension: string; value: string; audience: string }[], dimension: string, value: string, audience = "member") =>
    rows.find((r) => r.dimension === dimension && r.value === value && r.audience === audience) as undefined | { events: number; visits: number; members: number };
  const periodsUsed = () => [
    ["day", recentDay],
    ["week", sundayOf(recentDay)],
    ["month", monthOf(recentDay)],
    ["day", oldDay],
    ["week", sundayOf(oldDay)],
    ["month", monthOf(oldDay)],
  ];

  async function clean() {
    await db.from("analytics_events").delete().in("user_id", [alice, bob].filter(Boolean));
    await db.from("analytics_rollups").delete().like("event", "rt\\_%");
    for (const [kind, start] of periodsUsed()) await db.from("analytics_rollup_periods").delete().eq("period_kind", kind).eq("period_start", start);
  }

  beforeAll(async () => {
    const make = async (label: string) => {
      const { data, error } = await db.auth.admin.createUser({ email: `rollup-${label}-${ts}@example.com`, email_confirm: true });
      if (error) throw new Error(error.message);
      return data.user.id;
    };
    alice = await make("alice");
    bob = await make("bob");
    await clean();

    const session = crypto.randomUUID();
    const rows = [
      event(alice, "rt_clicked", recentAt, { session_id: session, properties: { name: "save-goal" } }),
      event(alice, "rt_clicked", recentAt + 3_600_000, { session_id: session, properties: { name: "save-goal" } }),
      event(bob, "rt_clicked", recentAt + 2 * 3_600_000, { properties: { name: "save-goal" }, context: { route: "/projects", viewport: "sm", browser: "Safari", browser_version: "17.5", os: "iOS", os_version: "17.5", device_type: "phone" } }),
      event(alice, "rt_acted", recentAt + 3 * 3_600_000, { source: "server", properties: { action: "project_created", ok: true }, context: {} }),
      // Sudo: an admin looking as a member counts under its own audience.
      event(alice, "rt_clicked", recentAt + 4 * 3_600_000, { sudo: true, properties: { name: "save-goal" } }),
      // Too old to keep, and the app's own record from the same day.
      event(alice, "rt_old", oldAt),
      event(bob, "rt_old", oldAt + 3_600_000),
      event(alice, "rt_sent", oldAt + 2 * 3_600_000, { source: "system", session_id: null, properties: { kind: "k", channel: "slack" }, context: {} }),
      // Inside the two-day grace period.
      event(alice, "rt_today", todayAt),
    ];
    const { error } = await db.from("analytics_events").insert(rows);
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    await clean();
    await db.auth.admin.deleteUser(alice);
    await db.auth.admin.deleteUser(bob);
  });

  it("rolls up completed days, weeks and months with counts but no ids, one dimension at a time", async () => {
    const result = await rollUpAndPruneUsageEvents(db);
    expect(result.stoppedEarly).toBe(false);

    const day = await rollups("day", recentDay, "rt_clicked");
    expect(cell(day, "total", "")).toEqual(expect.objectContaining({ events: 3, visits: 2, members: 2 }));
    expect(cell(day, "route", "/dashboard")).toEqual(expect.objectContaining({ events: 2, members: 1 }));
    expect(cell(day, "route", "/projects")).toEqual(expect.objectContaining({ events: 1 }));
    expect(cell(day, "control", "save-goal")).toEqual(expect.objectContaining({ events: 3 }));
    expect(cell(day, "browser", "Chrome 126.0")).toEqual(expect.objectContaining({ events: 2 }));
    expect(cell(day, "browser", "Safari 17.5")).toEqual(expect.objectContaining({ events: 1 }));
    expect(cell(day, "os", "iOS 17.5")).toEqual(expect.objectContaining({ events: 1 }));
    expect(cell(day, "device_type", "phone")).toEqual(expect.objectContaining({ events: 1 }));
    expect(cell(day, "viewport", "sm")).toEqual(expect.objectContaining({ events: 1 }));
    // The sudo event is counted apart, not with the member.
    expect(cell(day, "total", "", "sudo")).toEqual(expect.objectContaining({ events: 1 }));
    // Nothing in a rollup row identifies anyone.
    expect(Object.keys(day[0]).sort()).toEqual(["audience", "dimension", "event", "events", "members", "period_kind", "period_start", "value", "visits"]);

    const action = await rollups("day", recentDay, "rt_acted");
    expect(cell(action, "action", "project_created/true")).toEqual(expect.objectContaining({ events: 1 }));

    // The week has its own distinct counts: it is computed from the events, not summed from days.
    const week = await rollups("week", sundayOf(recentDay), "rt_clicked");
    if (addDays(sundayOf(recentDay), 7) <= localDate(NOW - 2 * DAY)) {
      expect(cell(week, "total", "")).toEqual(expect.objectContaining({ events: 3, members: 2 }));
    } else {
      expect(week).toEqual([]); // not completed yet
    }
    // The month is rolled up only once it has been over for two days.
    const month = await rollups("month", monthOf(recentDay), "rt_clicked");
    if (nextMonth(monthOf(recentDay)) <= localDate(NOW - 2 * DAY)) expect(cell(month, "total", "")).toEqual(expect.objectContaining({ events: 3 }));
    else expect(month).toEqual([]);
    // Today is inside the grace period: not rolled up, and its event is kept.
    expect(await rollups("day", localDate(todayAt), "rt_today")).toEqual([]);
  });

  it("removes old usage events once their totals are kept, and keeps the app's own records and recent events", async () => {
    // The old events' day, week and month were rolled up in the first test (they are long over), then pruned.
    const left = async (name: string) => (await db.from("analytics_events").select("id").eq("event", name).in("user_id", [alice, bob])).data ?? [];
    expect(await left("rt_old")).toEqual([]);
    expect(await left("rt_sent")).toHaveLength(1);
    expect(await left("rt_clicked")).toHaveLength(4);
    expect(await left("rt_today")).toHaveLength(1);
    // Their totals are still there.
    const old = await rollups("day", oldDay, "rt_old");
    expect(cell(old, "total", "")).toEqual(expect.objectContaining({ events: 2, members: 2 }));
  });

  it("does nothing a second time, and recomputing a period replaces it rather than adding", async () => {
    const again = await rollUpAndPruneUsageEvents(db);
    expect(again.pruned).toBe(0);
    const { error } = await db.rpc("analytics_rollup_period", { p_kind: "day", p_start: recentDay, p_tz: ORG_TIMEZONE });
    expect(error).toBeNull();
    const day = await rollups("day", recentDay, "rt_clicked");
    expect(cell(day, "total", "")).toEqual(expect.objectContaining({ events: 3 }));
  });

  it("refuses to remove an event whose period has not been rolled up", async () => {
    const unrolledAt = oldAt - 40 * DAY;
    const { error } = await db.from("analytics_events").insert(event(alice, "rt_unrolled", unrolledAt));
    expect(error).toBeNull();
    // A cutoff far enough ahead to include it, but its day has no rollup row.
    const { data } = await db.rpc("analytics_prune_usage_events", { p_cutoff: iso(monthsBefore(NOW, RETENTION.usageMonths).getTime()), p_tz: ORG_TIMEZONE, p_limit: 5000 });
    expect(data).toBe(0);
    const { data: kept } = await db.from("analytics_events").select("id").eq("event", "rt_unrolled").eq("user_id", alice);
    expect(kept).toHaveLength(1);
  });
});
