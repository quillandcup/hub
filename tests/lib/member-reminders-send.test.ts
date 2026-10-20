import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeQuery, type FakeSupabase, type FakeTables } from "@/tests/helpers/server-page";
import { APP_URL, ATTENDANCE_DATA_STARTS_ON, SLACK_INTRO_CHANNEL, SLACK_WORKSPACE_URL } from "@/lib/config";
import { sendHourFor } from "@/lib/nudge-jitter";

// The reminder job end to end with Supabase, Slack and the calendar loader faked: what matters is
// who gets which reminder and when, not what the queries look like.
const sendSlackDM = vi.fn(async (_params: { slackUserId: string; text: string; blocks?: any[] }) => {});
vi.mock("@/lib/slack", () => ({ sendSlackDM: (p: any) => sendSlackDM(p) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => {}) }));

// Slack user id = "U-" + member id for every member in members, except those in notInSlack.
const notInSlack = new Set<string>();
vi.mock("@/lib/slack-matching", () => ({
  matchSlackUsersToMembers: (_slack: unknown, members: { id: string }[]) =>
    new Map(members.filter((m) => !notInSlack.has(m.id)).map((m) => [`U-${m.id}`, m.id])),
}));

const calendarPrickleIds = vi.fn(async (_supabase: unknown, _memberId: string): Promise<Set<string>> => new Set());
vi.mock("@/lib/calendar-feed", () => ({
  loadCalendarFeedPrickleIds: (supabase: unknown, memberId: string) => calendarPrickleIds(supabase, memberId),
}));

vi.mock("@/lib/cron-heartbeats", () => ({ withCronHeartbeat: async (_job: string, res: Response) => res }));

let fake: FakeSupabase;
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fake }));

const { POST } = await import("@/app/api/internal/member-reminders/route");
const { sendMemberReminders } = await import("@/lib/member-reminders");
const { membersWithFeatureForOutreach } = await import("@/lib/features.server");

const DAY = 24 * 60 * 60 * 1000;

/** 2026-10-13 is in daylight time: New York is UTC-4, Tokyo UTC+9. */
const atNewYorkHour = (hour: number) => new Date(Date.UTC(2026, 9, 13, hour + 4));
const atTokyoHour = (hour: number) => new Date(Date.UTC(2026, 9, 13, hour - 9));
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const joinedDaysBefore = (now: Date, days: number) => dateOnly(new Date(now.getTime() - days * DAY));

/** The moment (New York) this member's `sent + 1`th reminder of `kind` is meant to go out. */
const sendTime = (memberId: string, kind: string, sent = 0) => atNewYorkHour(sendHourFor(`${memberId}:${kind}:${sent}`));

interface LogRow {
  id: string;
  member_id: string;
  kind: string;
  sent_at: string;
  sent_on: string;
}

/** Rows whose member_id is in the query's `.in("member_id", ids)`, or all of them without one. */
function forMembers<T extends { member_id: string }>(rows: T[]) {
  return (query: FakeQuery) => {
    const filter = query.calls.find((c) => c.method === "in" && c.args[0] === "member_id");
    const ids = filter ? (filter.args[1] as string[]) : null;
    return { data: rows.filter((r) => !ids || ids.includes(r.member_id)) };
  };
}

/** member_reminder_log that behaves like its UNIQUE (member_id, kind, sent_on) constraint. */
function nudgeLog(initial: LogRow[] = []) {
  const rows = [...initial];
  const table = (query: FakeQuery) => {
    if (query.calls.some((c) => c.method === "delete")) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (query.calls.filter((c) => c.method === "eq").every((c) => rows[i][c.args[0] as keyof LogRow] === c.args[1])) rows.splice(i, 1);
      }
      return { data: [] };
    }
    const insert = query.calls.find((c) => c.method === "insert");
    if (!insert) return forMembers(rows)(query);
    const row = insert.args[0] as Omit<LogRow, "id">;
    if (rows.some((r) => r.member_id === row.member_id && r.kind === row.kind && r.sent_on === row.sent_on)) {
      return { data: null, error: { code: "23505" } };
    }
    const id = `log${rows.length + 1}`;
    rows.push({ id, ...row });
    return { data: [{ id }] };
  };
  return { table, rows };
}

const member = (id: string, firstJoinedAt: string | null, userId: string | null = null) => ({
  id,
  first_joined_at: firstJoinedAt,
  user_id: userId,
});

/** A member has opted in to Slack for a kind that's off by default. */
const optIn = (memberId: string, kind: string) => ({ member_id: memberId, kind, channel: "slack", enabled: true });

const loggedSent = (memberId: string, kind: string, daysBefore: number, now: Date): LogRow => ({
  id: `old-${memberId}-${kind}-${daysBefore}`,
  member_id: memberId,
  kind,
  sent_at: new Date(now.getTime() - daysBefore * DAY).toISOString(),
  sent_on: dateOnly(new Date(now.getTime() - daysBefore * DAY)),
});

/** Canned tables by name, plus `log` to preload member_reminder_log. */
type Tables = { [table: string]: FakeTables[string] | ReturnType<typeof nudgeLog> | undefined; log?: ReturnType<typeof nudgeLog> };

function setup({ log = nudgeLog(), ...rest }: Tables = {}) {
  fake = createFakeSupabase({
    "bronze.slack_channels": { data: [{ channel_id: "C-START" }] },
    member_reminder_log: log.table,
    ...(rest as FakeTables),
  });
  return log;
}

const slackTexts = () => sendSlackDM.mock.calls.map((c) => c[0].text);
const slackTargets = () => sendSlackDM.mock.calls.map((c) => c[0].slackUserId);

beforeEach(() => {
  vi.restoreAllMocks();
  sendSlackDM.mockClear();
  notInSlack.clear();
  calendarPrickleIds.mockReset();
  calendarPrickleIds.mockResolvedValue(new Set());
  process.env.CRON_INTERNAL_SECRET = "test-secret";
});

describe("intro reminders", () => {
  it("reminds a newcomer who hasn't posted in the intro channel, linking to the channel, and logs it", async () => {
    const now = sendTime("m1", "intro_nudge");
    const log = setup({ members: { data: [member("m1", joinedDaysBefore(now, 10))] } });

    expect(await sendMemberReminders(fake as never, now)).toEqual({ intro: 1, prickle: 0, dryRun: { intro: 0, prickle: 0 } });

    expect(slackTargets()).toEqual(["U-m1"]);
    expect(slackTexts()[0]).toContain(`#${SLACK_INTRO_CHANNEL}`);
    const blocks = sendSlackDM.mock.calls[0][0].blocks!;
    expect(JSON.stringify(blocks)).toContain(`${SLACK_WORKSPACE_URL}/app_redirect?channel=C-START`);
    expect(log.rows).toEqual([expect.objectContaining({ member_id: "m1", kind: "intro_nudge", sent_on: dateOnly(now) })]);
  });

  it("leaves a newcomer alone once they've introduced themselves", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({
      members: { data: [member("m1", joinedDaysBefore(now, 10))] },
      member_activities: forMembers([{ member_id: "m1" }]),
    });

    expect(await sendMemberReminders(fake as never, now)).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("only looks for posts in the intro channel, as top-level messages from Slack", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: { data: [member("m1", joinedDaysBefore(now, 10))] } });

    await sendMemberReminders(fake as never, now);

    const query = fake.queries.find((q) => q.table === "member_activities")!;
    const eqs = query.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["source", "slack"]);
    expect(eqs).toContainEqual(["activity_type", "slack_message"]);
    expect(eqs).toContainEqual(["data->>channel_name", SLACK_INTRO_CHANNEL]);
  });

  it("marks earlier in-app reminders read once they've introduced themselves", async () => {
    const now = sendTime("m1", "intro_nudge", 1);
    setup({
      members: { data: [member("m1", joinedDaysBefore(now, 20))] },
      member_activities: forMembers([{ member_id: "m1" }]),
      log: nudgeLog([loggedSent("m1", "intro_nudge", 8, now)]),
    });

    await sendMemberReminders(fake as never, now);

    const resolve = fake.queries.find((q) => q.table === "in_app_notifications")!;
    expect(resolve.calls.map((c) => c.method)).toContain("update");
    expect(resolve.calls).toContainEqual({ method: "eq", args: ["kind", "intro_nudge"] });
    expect(resolve.calls).toContainEqual({ method: "eq", args: ["ref", "intro"] });
  });

  it("skips a member we haven't matched to a Slack user, even where the Hub could reach them", async () => {
    const now = sendTime("m1", "intro_nudge");
    notInSlack.add("m1");
    const log = setup({
      // In-app notifications are on for everyone with an account, so the Hub can reach m1 even though Slack can't.
      members: { data: [member("m1", joinedDaysBefore(now, 10), "u1")] },
      feature_flags: { data: [{ enabled_globally: true }] },
    });

    expect(await sendMemberReminders(fake as never, now)).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(log.rows).toEqual([]);
    expect(fake.queries.some((q) => q.table === "in_app_notifications" && q.calls.some((c) => c.method === "insert"))).toBe(false);
  });

  it("does reach a matched member in-app too", async () => {
    const now = sendTime("m1", "intro_nudge");
    const log = setup({
      members: { data: [member("m1", joinedDaysBefore(now, 10), "u1")] },
      feature_flags: { data: [{ enabled_globally: true }] },
    });

    expect((await sendMemberReminders(fake as never, now)).intro).toBe(1);
    expect(fake.queries.some((q) => q.table === "in_app_notifications" && q.calls.some((c) => c.method === "insert"))).toBe(true);
    expect(log.rows).toHaveLength(1);
  });

  it("waits until the second day after joining", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: { data: [member("m1", joinedDaysBefore(now, 1)), member("m2", joinedDaysBefore(now, 2))] } });

    await sendMemberReminders(fake as never, sendTime("m2", "intro_nudge"));

    expect(slackTargets()).toEqual(["U-m2"]);
  });

  it("only goes out in the member's own hour", async () => {
    const hour = sendHourFor("m1:intro_nudge:0");
    const wrongHour = hour === 9 ? 10 : hour - 1;
    const rows = [member("m1", "2026-10-01")];
    setup({ members: { data: rows } });

    expect(await sendMemberReminders(fake as never, atNewYorkHour(wrongHour))).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
    expect(await sendMemberReminders(fake as never, atNewYorkHour(hour))).toEqual({ intro: 1, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
  });

  it("spaces reminders out, and doesn't send twice in one day", async () => {
    const now = sendTime("m1", "intro_nudge");
    const log = setup({ members: { data: [member("m1", joinedDaysBefore(now, 30))] } });
    // Each later reminder is sent in an hour of its own.
    const later = (days: number) => new Date(sendTime("m1", "intro_nudge", 1).getTime() + days * DAY);

    await sendMemberReminders(fake as never, now);
    await sendMemberReminders(fake as never, now);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);

    await sendMemberReminders(fake as never, later(3));
    expect(sendSlackDM).toHaveBeenCalledTimes(1);

    await sendMemberReminders(fake as never, later(9));
    expect(sendSlackDM).toHaveBeenCalledTimes(2);
    expect(log.rows).toHaveLength(2);
  });

  it("stops after four reminders", async () => {
    const now = sendTime("m1", "intro_nudge", 4);
    setup({
      members: { data: [member("m1", joinedDaysBefore(now, 80))] },
      log: nudgeLog([60, 50, 40, 30].map((d) => loggedSent("m1", "intro_nudge", d, now))),
    });

    expect(await sendMemberReminders(fake as never, now)).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
  });

  it("doesn't remind someone past their first 90 days", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: { data: [member("m1", joinedDaysBefore(now, 120))] } });

    expect((await sendMemberReminders(fake as never, now)).intro).toBe(0);
  });

  it("skips a member who turned the reminders off, without logging it", async () => {
    const now = sendTime("m1", "intro_nudge");
    const log = setup({
      members: { data: [member("m1", joinedDaysBefore(now, 10))] },
      notification_preferences: { data: [
        { member_id: "m1", kind: "intro_nudge", channel: "slack", enabled: false },
        { member_id: "m1", kind: "intro_nudge", channel: "in_app", enabled: false },
      ] },
    });

    expect((await sendMemberReminders(fake as never, now)).intro).toBe(0);
    expect(log.rows).toEqual([]);
  });

  it("retries a failed reminder without advancing its backoff, then deduplicates success", async () => {
    const now = sendTime("m1", "intro_nudge");
    const log = setup({
      members: { data: [member("m1", joinedDaysBefore(now, 10))] },
      notification_preferences: { data: [
        { member_id: "m1", kind: "intro_nudge", channel: "in_app", enabled: false },
      ] },
    });
    sendSlackDM.mockRejectedValueOnce(new Error("channel_not_found"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await sendMemberReminders(fake as never, now)).intro).toBe(0);
    expect(log.rows).toEqual([]);
    expect((await sendMemberReminders(fake as never, now)).intro).toBe(1);
    expect((await sendMemberReminders(fake as never, now)).intro).toBe(0);
    expect(log.rows).toHaveLength(1);
    expect(sendSlackDM).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed reminder claim release and preserves its dedup record", async () => {
    const now = sendTime("m1", "intro_nudge");
    const log = nudgeLog();
    setup({
      members: { data: [member("m1", joinedDaysBefore(now, 10))] },
      notification_preferences: { data: [
        { member_id: "m1", kind: "intro_nudge", channel: "in_app", enabled: false },
      ] },
      member_reminder_log: (query: FakeQuery) => query.calls.some((c) => c.method === "delete")
        ? { error: { message: "database unavailable" } }
        : log.table(query),
    });
    sendSlackDM.mockRejectedValueOnce(new Error("channel_not_found"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendMemberReminders(fake as never, now)).rejects.toThrow(
      "Releasing intro_nudge notification claim failed: database unavailable"
    );
    expect(log.rows).toHaveLength(1);
    expect((await sendMemberReminders(fake as never, now)).intro).toBe(0);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });
});

describe("prickle reminders", () => {
  const kind = "prickle_nudge";
  const NOW = sendTime("m1", kind);

  it("is off until a member opts in", async () => {
    const log = setup({ members: { data: [member("m1", "2026-09-01")] } });

    expect((await sendMemberReminders(fake as never, NOW)).prickle).toBe(0);
    expect(log.rows).toEqual([]);
  });

  it("asks someone who has never been to schedule their first prickle", async () => {
    setup({
      members: { data: [member("m1", ATTENDANCE_DATA_STARTS_ON)] },
      notification_preferences: { data: [optIn("m1", kind)] },
    });

    expect((await sendMemberReminders(fake as never, NOW)).prickle).toBe(1);
    expect(slackTexts()[0]).toContain("first writing session");
    expect(JSON.stringify(sendSlackDM.mock.calls[0][0].blocks)).toContain(`${APP_URL}/my-prickles`);
  });

  it("never calls it their first for a long-time member we can't see the history of", async () => {
    setup({
      members: { data: [member("m1", "2022-03-01")] },
      notification_preferences: { data: [optIn("m1", kind)] },
    });

    await sendMemberReminders(fake as never, NOW);

    expect(slackTexts()[0]).toContain("next prickle");
    expect(slackTexts()[0]).not.toContain("first");
  });

  it("says it misses someone who used to come", async () => {
    setup({
      members: { data: [member("m1", "2022-03-01")] },
      notification_preferences: { data: [optIn("m1", kind)] },
      prickle_attendance: forMembers([{ member_id: "m1", join_time: new Date(NOW.getTime() - 60 * DAY).toISOString() }]),
    });

    await sendMemberReminders(fake as never, NOW);

    expect(slackTexts()[0]).toContain("miss");
  });

  it("leaves alone a member who attended in the last 30 days", async () => {
    setup({
      members: { data: [member("m1", "2022-03-01")] },
      notification_preferences: { data: [optIn("m1", kind)] },
      prickle_attendance: forMembers([{ member_id: "m1", join_time: new Date(NOW.getTime() - 10 * DAY).toISOString() }]),
    });

    expect((await sendMemberReminders(fake as never, NOW)).prickle).toBe(0);
  });

  it("leaves alone a member who already has a prickle coming up, and logs nothing", async () => {
    const log = setup({
      members: { data: [member("m1", "2026-09-01"), member("m2", "2026-09-01")] },
      notification_preferences: { data: [optIn("m1", kind), optIn("m2", kind)] },
    });
    calendarPrickleIds.mockImplementation(async (_s, memberId) => new Set(memberId === "m1" ? ["p1"] : []));
    // m2 gets it at their own hour, so look at each in turn.
    expect((await sendMemberReminders(fake as never, sendTime("m1", kind))).prickle).toBe(0);
    expect((await sendMemberReminders(fake as never, sendTime("m2", kind))).prickle).toBe(1);

    expect(slackTargets()).toEqual(["U-m2"]);
    expect(log.rows.map((r) => r.member_id)).toEqual(["m2"]);
  });

  it("only checks calendars for members who opted in and are due", async () => {
    setup({
      members: { data: [member("m1", "2026-09-01"), member("m2", "2026-09-01")] },
      notification_preferences: { data: [optIn("m1", kind)] },
    });

    await sendMemberReminders(fake as never, sendTime("m1", kind));

    expect(calendarPrickleIds.mock.calls.map((c) => c[1])).toEqual(["m1"]);
  });

  it("backs off, but never stops: weekly at first, then monthly after a long run of reminders", async () => {
    const week = (n: number) => Array.from({ length: n }, (_, i) => i);
    const sentTimes = (n: number, lastDaysBefore: number, now: Date) =>
      [...week(n - 1).map((i) => 400 - i * 7), lastDaysBefore].map((d) => loggedSent("m1", kind, d, now));
    const run = async (n: number, lastDaysBefore: number) => {
      const now = sendTime("m1", kind, n);
      setup({
        members: { data: [member("m1", "2022-03-01")] },
        notification_preferences: { data: [optIn("m1", kind)] },
        log: nudgeLog(sentTimes(n, lastDaysBefore, now)),
      });
      return (await sendMemberReminders(fake as never, now)).prickle;
    };

    expect(await run(1, 5)).toBe(0);
    expect(await run(1, 9)).toBe(1);
    expect(await run(9, 24)).toBe(0);
    expect(await run(9, 36)).toBe(1);
    expect(await run(40, 36)).toBe(1);
  });

  it("starts the backoff over after the member comes back", async () => {
    const now = sendTime("m1", kind);
    const lastAttended = new Date(now.getTime() - 45 * DAY).toISOString();
    setup({
      members: { data: [member("m1", "2022-03-01")] },
      notification_preferences: { data: [optIn("m1", kind)] },
      prickle_attendance: forMembers([{ member_id: "m1", join_time: lastAttended }]),
      // Reminders from before they last attended don't count against them now.
      log: nudgeLog([60, 70, 80, 90, 100].map((d) => loggedSent("m1", kind, d, now))),
    });

    expect((await sendMemberReminders(fake as never, now)).prickle).toBe(1);
  });

  it("goes out in the member's own time zone, falling back to the org's", async () => {
    const tokyoHour = sendHourFor("m1:prickle_nudge:0");
    const orgHour = sendHourFor("m2:prickle_nudge:0");
    setup({
      members: { data: [member("m1", "2026-09-01", "u1"), member("m2", "2026-09-01", "u2")] },
      notification_preferences: { data: [optIn("m1", kind), optIn("m2", kind)] },
      // "browser" means they never picked one.
      user_profiles: {
        data: [
          { id: "u1", timezone_preference: "Asia/Tokyo" },
          { id: "u2", timezone_preference: "browser" },
        ],
      },
    });

    await sendMemberReminders(fake as never, atTokyoHour(tokyoHour));
    expect(slackTargets()).toEqual(["U-m1"]);
    await sendMemberReminders(fake as never, atNewYorkHour(orgHour));
    expect(slackTargets()).toEqual(["U-m1", "U-m2"]);
  });
});

describe("dry run", () => {
  const nobodyLive = async () => new Set<string>();
  // One entry per logged reminder: its kind plus the JSON the job printed.
  const dryRunLines = (log: { mock: { calls: unknown[][] } }): Record<string, any>[] =>
    log.mock.calls
      .filter((c) => String(c[0]).includes("DRY RUN intro_nudge") || String(c[0]).includes("DRY RUN prickle_nudge"))
      .map((c) => ({ kind: String(c[0]).split("DRY RUN ")[1], ...JSON.parse(String(c[1])) }));

  it("logs who would get the intro reminder, why and what it says, and sends and records nothing", async () => {
    const now = sendTime("m1", "intro_nudge");
    const log = setup({
      members: { data: [member("m1", joinedDaysBefore(now, 10))] },
      member_activities: forMembers([]),
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await sendMemberReminders(fake as never, now, { liveFor: nobodyLive });

    expect(result).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 1, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(log.rows).toEqual([]);
    expect(fake.queries.some((q) => q.calls.some((c) => c.method === "insert" || c.method === "update"))).toBe(false);
    const [line] = dryRunLines(spy);
    expect(line).toMatchObject({
      kind: "intro_nudge",
      memberId: "m1",
      wouldSend: true,
      channels: ["slack", "in_app"],
      why: { daysSinceJoined: 10, remindersSentBefore: 0, postedInIntroChannel: false, matchedToSlackUser: true },
    });
    expect(line.text).toContain(`#${SLACK_INTRO_CHANNEL}`);
    expect(line.url).toBe(`${SLACK_WORKSPACE_URL}/app_redirect?channel=C-START`);
  });

  it("doesn't mark earlier in-app reminders read", async () => {
    const now = sendTime("m1", "intro_nudge", 1);
    setup({
      members: { data: [member("m1", joinedDaysBefore(now, 20))] },
      member_activities: forMembers([{ member_id: "m1" }]),
      log: nudgeLog([loggedSent("m1", "intro_nudge", 8, now)]),
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await sendMemberReminders(fake as never, now, { liveFor: nobodyLive });

    expect(fake.queries.some((q) => q.table === "in_app_notifications")).toBe(false);
  });

  it("lists prickle reminders even for members who haven't opted in, marked as not sent", async () => {
    const kind = "prickle_nudge";
    const now = sendTime("m1", kind);
    setup({
      members: { data: [member("m1", ATTENDANCE_DATA_STARTS_ON), member("m2", ATTENDANCE_DATA_STARTS_ON)] },
      notification_preferences: { data: [optIn("m2", kind)] },
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Each member's reminder is due in their own hour; check m1's, who hasn't opted in.
    const result = await sendMemberReminders(fake as never, now, { liveFor: nobodyLive });
    const lines = dryRunLines(spy);

    expect(sendSlackDM).not.toHaveBeenCalled();
    const m1 = lines.find((l) => l.memberId === "m1");
    expect(m1).toMatchObject({
      kind,
      wouldSend: false,
      channels: [],
      why: { variant: "first", nothingOnCalendar: true, lastAttended: null, remindersSinceLastAttended: 0 },
    });
    expect(m1?.text).toContain("first writing session");
    expect(result.dryRun.prickle).toBe(0);
  });

  it("counts a would-be prickle reminder once the member has opted in, and still skips someone with a prickle coming up", async () => {
    const kind = "prickle_nudge";
    const now = sendTime("m1", kind);
    setup({
      members: { data: [member("m1", "2022-03-01")] },
      notification_preferences: { data: [optIn("m1", kind)] },
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect((await sendMemberReminders(fake as never, now, { liveFor: nobodyLive })).dryRun.prickle).toBe(1);
    expect(dryRunLines(spy)[0]).toMatchObject({ wouldSend: true, channels: ["slack"], why: { variant: "next" } });

    calendarPrickleIds.mockResolvedValue(new Set(["p1"]));
    spy.mockClear();
    expect((await sendMemberReminders(fake as never, now, { liveFor: nobodyLive })).dryRun.prickle).toBe(0);
    expect(dryRunLines(spy)).toEqual([]);
  });

  it("sends for real to members it's live for and only logs the rest, in the same pass", async () => {
    const now = sendTime("m1", "intro_nudge");
    // Both are due at the same hour; m2's send hour is made to match m1's by choosing members that share it.
    const sameHour = ["m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"].find(
      (id) => sendHourFor(`${id}:intro_nudge:0`) === sendHourFor("m1:intro_nudge:0")
    )!;
    const log = setup({
      members: { data: [member("m1", joinedDaysBefore(now, 10)), member(sameHour, joinedDaysBefore(now, 10))] },
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await sendMemberReminders(fake as never, now, { liveFor: async () => new Set(["m1"]) });

    expect(result).toEqual({ intro: 1, prickle: 0, dryRun: { intro: 1, prickle: 0 } });
    expect(slackTargets()).toEqual(["U-m1"]);
    expect(log.rows.map((r) => r.member_id)).toEqual(["m1"]);
    expect(dryRunLines(spy).map((l) => l.memberId)).toEqual([sameHour]);
  });
});

describe("the reminder feature flags", () => {
  const request = () =>
    new NextRequest("http://localhost/api/internal/member-reminders", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    });
  /** feature_flags where exactly these keys are switched on globally. */
  const flagsOn = (...keys: string[]) => (query: FakeQuery) => ({
    data: [{ enabled_globally: keys.includes(String(query.calls.find((c) => c.method === "eq" && c.args[0] === "feature_key")?.args[1])) }],
  });

  async function runRoute(tables: Record<string, any>, memberKind: "intro" | "prickle" = "intro") {
    const now = memberKind === "intro" ? sendTime("m1", "intro_nudge") : sendTime("m1", "prickle_nudge");
    const joined = memberKind === "intro" ? joinedDaysBefore(now, 10) : "2022-03-01";
    setup({ members: { data: [member("m1", joined, "u1")] }, ...tables });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      return { body: await (await POST(request())).json(), spy };
    } finally {
      vi.useRealTimers();
    }
  }

  it("only logs, sending nothing, while the flag is off", async () => {
    const { body, spy } = await runRoute({ feature_flags: flagsOn() });

    expect(body).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 1, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(spy.mock.calls.some((c) => String(c[0]).includes("DRY RUN intro_nudge"))).toBe(true);
  });

  it("sends intro reminders for real once intro_reminders is on globally", async () => {
    const { body } = await runRoute({ feature_flags: flagsOn("intro_reminders") });

    expect(body).toEqual({ intro: 1, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });

  it("keeps intro reminders dry when only prickle_reminders is on", async () => {
    const { body } = await runRoute({ feature_flags: flagsOn("prickle_reminders") });

    expect(body).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 1, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("keeps prickle reminders dry when only intro_reminders is on, and sends them once prickle_reminders is", async () => {
    const tables = { notification_preferences: { data: [optIn("m1", "prickle_nudge")] } };

    const dry = await runRoute({ ...tables, feature_flags: flagsOn("intro_reminders") }, "prickle");
    expect(dry.body).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 1 } });
    expect(sendSlackDM).not.toHaveBeenCalled();

    const live = await runRoute({ ...tables, feature_flags: flagsOn("prickle_reminders") }, "prickle");
    expect(live.body).toEqual({ intro: 0, prickle: 1, dryRun: { intro: 0, prickle: 0 } });
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });

  it("covers a member with their own preview of that flag even while it's off globally", async () => {
    const { body } = await runRoute({
      feature_flags: flagsOn(),
      user_feature_previews: { data: [{ user_id: "u1" }] },
    });

    expect(body.intro).toBe(1);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });

  it("covers a member without a Hub account when it's on globally (Slack needs none)", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({
      members: { data: [member("m1", joinedDaysBefore(now, 10), null)] },
      feature_flags: flagsOn("intro_reminders"),
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect((await sendMemberReminders(fake as never, now, {
      liveFor: (_kind, ids) => membersWithFeatureForOutreach(fake, "intro_reminders", ids),
    })).intro).toBe(1);
  });
});

describe("the route", () => {
  const request = (headers: Record<string, string> = {}) =>
    new NextRequest("http://localhost/api/internal/member-reminders", { method: "POST", headers });

  it("rejects a request without the cron secret", async () => {
    setup({ members: { data: [member("m1", "2026-10-01")] } });

    expect((await POST(request())).status).toBe(401);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("runs with the secret and reports what it sent", async () => {
    setup({ members: { data: [] } });

    const res = await POST(request({ authorization: "Bearer test-secret" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
  });
});
