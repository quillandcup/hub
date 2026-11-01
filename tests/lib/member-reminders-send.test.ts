import { useFakeClock } from "../helpers/fake-clock";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { APP_URL, ATTENDANCE_DATA_STARTS_ON, SLACK_INTRO_CHANNEL, SLACK_WORKSPACE_URL } from "@/lib/config";
import { sendHourFor } from "@/lib/nudge-jitter";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { ActivityRow } from "@/lib/data/activities";
import type { ReminderLogRow } from "@/lib/data/reminder-log";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

// The reminder job end to end on the in-memory repositories, with Slack and the calendar loader
// faked: what matters is who gets which reminder and when.
const sendSlackDM = vi.fn(async (_params: { slackUserId: string; text: string; blocks?: any[] }) => {});
vi.mock("@/lib/slack", () => ({ sendSlackDM: (p: any) => sendSlackDM(p) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => {}) }));

// Slack user id = "U-" + member id for every member in members, except those in notInSlack.
const notInSlack = new Set<string>();
vi.mock("@/lib/slack-matching", () => ({
  matchSlackUsersToMembers: (_slack: unknown, members: { id: string }[]) =>
    new Map(members.filter((m) => !notInSlack.has(m.id)).map((m) => [`U-${m.id}`, m.id])),
}));

const calendarPrickleIds = vi.fn(async (_repos: unknown, _memberId: string): Promise<Set<string>> => new Set());
vi.mock("@/lib/calendar-feed", () => ({
  loadCalendarFeedPrickleIds: (repos: unknown, memberId: string) => calendarPrickleIds(repos, memberId),
}));

vi.mock("@/lib/cron-heartbeats", () => ({ withCronHeartbeat: async (_job: string, res: Response) => res }));

// The route builds its repositories over the service-role client: the same in-memory ones here.
let dataset: InMemoryDataset;
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

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

const member = (id: string, firstJoinedAt: string | null, userId: string | null = null) => ({
  id,
  name: `Member ${id}`,
  firstJoinedAt,
  userId,
});

/** A member has opted in to Slack for a kind that's off by default. */
const optIn = (memberId: string, kind: string) => ({ memberId, kind, channel: "slack", enabled: true });
const optOut = (memberId: string, kind: string, channel: string) => ({ memberId, kind, channel, enabled: false });

const loggedSent = (memberId: string, kind: string, daysBefore: number, now: Date): ReminderLogRow => ({
  id: `old-${memberId}-${kind}-${daysBefore}`,
  memberId,
  kind,
  sentAt: new Date(now.getTime() - daysBefore * DAY).toISOString(),
  sentOn: dateOnly(new Date(now.getTime() - daysBefore * DAY)),
});

/** A top-level message the member posted in the intro channel. */
const introPost = (memberId: string): ActivityRow => ({
  id: `act-${memberId}`,
  member_id: memberId,
  activity_type: "slack_message",
  activity_category: "communication",
  title: "message",
  source: "slack",
  occurred_at: "2026-10-01T10:00:00Z",
  created_at: "2026-10-01T10:00:00Z",
  related_id: `act-${memberId}`,
  description: null,
  engagement_value: null,
  actor_kind: "member",
  actor_user_id: null,
  acting_as_member_id: null,
  duration_minutes: null,
  prickle_id: null,
  data: { channel_name: SLACK_INTRO_CHANNEL },
});

const flag = (key: string, enabled: boolean) => ({ feature_key: key, enabled_globally: enabled, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });

type Seed = NonNullable<ConstructorParameters<typeof InMemoryDataset>[0]> & { log?: ReminderLogRow[] };

/** Everything the job reads and writes, in memory; `log` preloads the reminder log. */
function setup({ log = [], ...seed }: Seed = {}) {
  dataset = new InMemoryDataset({
    slackChannels: [{ channel_id: "C-START", name: SLACK_INTRO_CHANNEL }],
    reminderLog: log,
    ...seed,
  });
  repos = createInMemoryRepos(dataset);
  return dataset;
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
  setup();
});

describe("intro reminders", () => {
  it("reminds a newcomer who hasn't posted in the intro channel, linking to the channel, and logs it", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: [member("m1", joinedDaysBefore(now, 10))] });

    expect(await sendMemberReminders(repos, now)).toEqual({ intro: 1, prickle: 0, dryRun: { intro: 0, prickle: 0 } });

    expect(slackTargets()).toEqual(["U-m1"]);
    expect(slackTexts()[0]).toContain(`#${SLACK_INTRO_CHANNEL}`);
    const blocks = sendSlackDM.mock.calls[0][0].blocks!;
    expect(JSON.stringify(blocks)).toContain(`${SLACK_WORKSPACE_URL}/app_redirect?channel=C-START`);
    expect(dataset.reminderLog).toEqual([expect.objectContaining({ memberId: "m1", kind: "intro_nudge", sentOn: dateOnly(now) })]);
  });

  it("leaves a newcomer alone once they've introduced themselves", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: [member("m1", joinedDaysBefore(now, 10))], activities: [introPost("m1")] });

    expect(await sendMemberReminders(repos, now)).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("marks earlier in-app reminders read once they've introduced themselves", async () => {
    const now = sendTime("m1", "intro_nudge", 1);
    setup({
      members: [member("m1", joinedDaysBefore(now, 20))],
      activities: [introPost("m1")],
      log: [loggedSent("m1", "intro_nudge", 8, now)],
      inAppNotifications: [
        { id: "n1", memberId: "m1", kind: "intro_nudge", ref: "intro", text: "t", url: null, bannerUntil: null, readAt: null, createdAt: "2026-10-05T00:00:00Z" },
        { id: "n2", memberId: "m1", kind: "prickle_nudge", ref: "intro", text: "t", url: null, bannerUntil: null, readAt: null, createdAt: "2026-10-05T00:00:00Z" },
      ],
    });

    await sendMemberReminders(repos, now);

    expect(dataset.inAppNotifications.map((n) => [n.id, n.readAt !== null])).toEqual([["n1", true], ["n2", false]]);
  });

  it("skips a member we haven't matched to a Slack user, even where the Hub could reach them", async () => {
    const now = sendTime("m1", "intro_nudge");
    notInSlack.add("m1");
    // In-app notifications are on for everyone with an account, so the Hub can reach m1 even though Slack can't.
    setup({ members: [member("m1", joinedDaysBefore(now, 10), "u1")] });

    expect(await sendMemberReminders(repos, now)).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(dataset.reminderLog).toEqual([]);
    expect(dataset.inAppNotifications).toEqual([]);
  });

  it("does reach a matched member in-app too", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: [member("m1", joinedDaysBefore(now, 10), "u1")] });

    expect((await sendMemberReminders(repos, now)).intro).toBe(1);
    expect(dataset.inAppNotifications).toEqual([expect.objectContaining({ memberId: "m1", kind: "intro_nudge" })]);
    expect(dataset.reminderLog).toHaveLength(1);
  });

  it("waits until the second day after joining", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: [member("m1", joinedDaysBefore(now, 1)), member("m2", joinedDaysBefore(now, 2))] });

    await sendMemberReminders(repos, sendTime("m2", "intro_nudge"));
    expect(slackTargets()).toEqual(["U-m2"]);
  });

  it("only goes out in the member's own hour", async () => {
    const hour = sendHourFor("m1:intro_nudge:0");
    const wrongHour = hour === 9 ? 10 : hour - 1;
    setup({ members: [member("m1", "2026-10-01")] });

    expect(await sendMemberReminders(repos, atNewYorkHour(wrongHour))).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
    expect(await sendMemberReminders(repos, atNewYorkHour(hour))).toEqual({ intro: 1, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
  });

  it("spaces reminders out, and doesn't send twice in one day", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: [member("m1", joinedDaysBefore(now, 30))] });
    // Each later reminder is sent in an hour of its own.
    const later = (days: number) => new Date(sendTime("m1", "intro_nudge", 1).getTime() + days * DAY);

    await sendMemberReminders(repos, now);
    await sendMemberReminders(repos, now);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);

    await sendMemberReminders(repos, later(3));
    expect(sendSlackDM).toHaveBeenCalledTimes(1);

    await sendMemberReminders(repos, later(9));
    expect(sendSlackDM).toHaveBeenCalledTimes(2);
    expect(dataset.reminderLog).toHaveLength(2);
  });

  it("stops after four reminders", async () => {
    const now = sendTime("m1", "intro_nudge", 4);
    setup({
      members: [member("m1", joinedDaysBefore(now, 80))],
      log: [60, 50, 40, 30].map((d) => loggedSent("m1", "intro_nudge", d, now)),
    });

    expect(await sendMemberReminders(repos, now)).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
  });

  it("doesn't remind someone past their first 90 days", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: [member("m1", joinedDaysBefore(now, 120))] });

    expect((await sendMemberReminders(repos, now)).intro).toBe(0);
  });

  it("skips a member who turned the reminders off, without logging it", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({
      members: [member("m1", joinedDaysBefore(now, 10))],
      notificationPreferences: [optOut("m1", "intro_nudge", "slack"), optOut("m1", "intro_nudge", "in_app")],
    });

    expect((await sendMemberReminders(repos, now)).intro).toBe(0);
    expect(dataset.reminderLog).toEqual([]);
  });

  it("retries a failed reminder without advancing its backoff, then deduplicates success", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({
      members: [member("m1", joinedDaysBefore(now, 10))],
      notificationPreferences: [optOut("m1", "intro_nudge", "in_app")],
    });
    sendSlackDM.mockRejectedValueOnce(new Error("channel_not_found"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await sendMemberReminders(repos, now)).intro).toBe(0);
    expect(dataset.reminderLog).toEqual([]);
    expect((await sendMemberReminders(repos, now)).intro).toBe(1);
    expect((await sendMemberReminders(repos, now)).intro).toBe(0);
    expect(dataset.reminderLog).toHaveLength(1);
    expect(sendSlackDM).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed reminder claim release and preserves its dedup record", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({
      members: [member("m1", joinedDaysBefore(now, 10))],
      notificationPreferences: [optOut("m1", "intro_nudge", "in_app")],
    });
    repos.reminderLog.release = async () => {
      throw new Error("Releasing intro_nudge notification claim failed: database unavailable");
    };
    sendSlackDM.mockRejectedValueOnce(new Error("channel_not_found"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendMemberReminders(repos, now)).rejects.toThrow(
      "Releasing intro_nudge notification claim failed: database unavailable"
    );
    expect(dataset.reminderLog).toHaveLength(1);
    expect((await sendMemberReminders(repos, now)).intro).toBe(0);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });
});

describe("prickle reminders", () => {
  const kind = "prickle_nudge";
  const NOW = sendTime("m1", kind);
  // The new-member default reads the clock, so pin it to the send time.
  useFakeClock(() => NOW.getTime());

  it("is off until a member opts in", async () => {
    setup({ members: [member("m1", "2025-01-01")] });

    expect((await sendMemberReminders(repos, NOW)).prickle).toBe(0);
    expect(dataset.reminderLog).toEqual([]);
  });

  it("is on by default for a new member, and off again once they opt out", async () => {
    const joined = joinedDaysBefore(NOW, 10);
    setup({ members: [member("m1", joined)] });
    expect((await sendMemberReminders(repos, NOW)).prickle).toBe(1);

    const optOut = ["slack", "in_app"].map((channel) => ({ memberId: "m1", kind, channel, enabled: false }));
    setup({ members: [member("m1", joined)], notificationPreferences: optOut });
    sendSlackDM.mockClear();
    expect((await sendMemberReminders(repos, NOW)).prickle).toBe(0);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("asks someone who has never been to schedule their first prickle", async () => {
    setup({ members: [member("m1", ATTENDANCE_DATA_STARTS_ON)], notificationPreferences: [optIn("m1", kind)] });

    expect((await sendMemberReminders(repos, NOW)).prickle).toBe(1);
    expect(slackTexts()[0]).toContain("first writing session");
    expect(JSON.stringify(sendSlackDM.mock.calls[0][0].blocks)).toContain(`${APP_URL}/my-prickles`);
  });

  it("never calls it their first for a long-time member we can't see the history of", async () => {
    setup({ members: [member("m1", "2022-03-01")], notificationPreferences: [optIn("m1", kind)] });

    await sendMemberReminders(repos, NOW);

    expect(slackTexts()[0]).toContain("next prickle");
    expect(slackTexts()[0]).not.toContain("first");
  });

  const attended = (memberId: string, joinTime: string) => ({ id: `att-${memberId}`, prickleId: "prkl_AAAAAAAAAAA1", memberId, joinTime, leaveTime: joinTime });

  it("says it misses someone who used to come", async () => {
    setup({
      members: [member("m1", "2022-03-01")],
      notificationPreferences: [optIn("m1", kind)],
      attendance: [attended("m1", new Date(NOW.getTime() - 60 * DAY).toISOString())],
    });

    await sendMemberReminders(repos, NOW);

    expect(slackTexts()[0]).toContain("miss");
  });

  it("leaves alone a member who attended in the last 30 days", async () => {
    setup({
      members: [member("m1", "2022-03-01")],
      notificationPreferences: [optIn("m1", kind)],
      attendance: [attended("m1", new Date(NOW.getTime() - 10 * DAY).toISOString())],
    });

    expect((await sendMemberReminders(repos, NOW)).prickle).toBe(0);
  });

  it("leaves alone a member who already has a prickle coming up, and logs nothing", async () => {
    setup({
      members: [member("m1", "2026-09-01"), member("m2", "2026-09-01")],
      notificationPreferences: [optIn("m1", kind), optIn("m2", kind)],
    });
    calendarPrickleIds.mockImplementation(async (_s, memberId) => new Set(memberId === "m1" ? ["p1"] : []));
    // m2 gets it at their own hour, so look at each in turn.
    expect((await sendMemberReminders(repos, sendTime("m1", kind))).prickle).toBe(0);
    expect((await sendMemberReminders(repos, sendTime("m2", kind))).prickle).toBe(1);

    expect(slackTargets()).toEqual(["U-m2"]);
    expect(dataset.reminderLog.map((r) => r.memberId)).toEqual(["m2"]);
  });

  it("only checks calendars for members who opted in and are due", async () => {
    setup({ members: [member("m1", "2026-09-01"), member("m2", "2026-09-01")], notificationPreferences: [optIn("m1", kind)] });

    await sendMemberReminders(repos, sendTime("m1", kind));

    expect(calendarPrickleIds.mock.calls.map((c) => c[1])).toEqual(["m1"]);
  });

  it("backs off, but never stops: weekly at first, then monthly after a long run of reminders", async () => {
    const week = (n: number) => Array.from({ length: n }, (_, i) => i);
    const sentTimes = (n: number, lastDaysBefore: number, now: Date) =>
      [...week(n - 1).map((i) => 400 - i * 7), lastDaysBefore].map((d) => loggedSent("m1", kind, d, now));
    const run = async (n: number, lastDaysBefore: number) => {
      const now = sendTime("m1", kind, n);
      setup({
        members: [member("m1", "2022-03-01")],
        notificationPreferences: [optIn("m1", kind)],
        log: sentTimes(n, lastDaysBefore, now),
      });
      return (await sendMemberReminders(repos, now)).prickle;
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
      members: [member("m1", "2022-03-01")],
      notificationPreferences: [optIn("m1", kind)],
      attendance: [attended("m1", lastAttended)],
      // Reminders from before they last attended don't count against them now.
      log: [60, 70, 80, 90, 100].map((d) => loggedSent("m1", kind, d, now)),
    });

    expect((await sendMemberReminders(repos, now)).prickle).toBe(1);
  });

  it("goes out in the member's own time zone, falling back to the org's", async () => {
    const tokyoHour = sendHourFor("m1:prickle_nudge:0");
    const orgHour = sendHourFor("m2:prickle_nudge:0");
    setup({
      members: [member("m1", "2026-09-01", "u1"), member("m2", "2026-09-01", "u2")],
      notificationPreferences: [optIn("m1", kind), optIn("m2", kind)],
      // "browser" means they never picked one.
      userProfiles: [
        { id: "u1", email: "u1@example.test", timezone_preference: "Asia/Tokyo" },
        { id: "u2", email: "u2@example.test", timezone_preference: "browser" },
      ],
    });

    await sendMemberReminders(repos, atTokyoHour(tokyoHour));
    expect(slackTargets()).toEqual(["U-m1"]);
    await sendMemberReminders(repos, atNewYorkHour(orgHour));
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
    setup({ members: [member("m1", joinedDaysBefore(now, 10))] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await sendMemberReminders(repos, now, { liveFor: nobodyLive });

    expect(result).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 1, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(dataset.reminderLog).toEqual([]);
    expect(dataset.inAppNotifications).toEqual([]);
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
      members: [member("m1", joinedDaysBefore(now, 20))],
      activities: [introPost("m1")],
      log: [loggedSent("m1", "intro_nudge", 8, now)],
      inAppNotifications: [{ id: "n1", memberId: "m1", kind: "intro_nudge", ref: "intro", text: "t", url: null, bannerUntil: null, readAt: null, createdAt: "2026-10-05T00:00:00Z" }],
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await sendMemberReminders(repos, now, { liveFor: nobodyLive });

    expect(dataset.inAppNotifications.map((n) => n.readAt)).toEqual([null]);
  });

  it("lists prickle reminders even for members who haven't opted in, marked as not sent", async () => {
    const kind = "prickle_nudge";
    const now = sendTime("m1", kind);
    setup({
      members: [member("m1", ATTENDANCE_DATA_STARTS_ON), member("m2", ATTENDANCE_DATA_STARTS_ON)],
      notificationPreferences: [optIn("m2", kind)],
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Each member's reminder is due in their own hour; check m1's, who hasn't opted in.
    const result = await sendMemberReminders(repos, now, { liveFor: nobodyLive });
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
    setup({ members: [member("m1", "2022-03-01")], notificationPreferences: [optIn("m1", kind)] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect((await sendMemberReminders(repos, now, { liveFor: nobodyLive })).dryRun.prickle).toBe(1);
    expect(dryRunLines(spy)[0]).toMatchObject({ wouldSend: true, channels: ["slack"], why: { variant: "next" } });

    calendarPrickleIds.mockResolvedValue(new Set(["p1"]));
    spy.mockClear();
    expect((await sendMemberReminders(repos, now, { liveFor: nobodyLive })).dryRun.prickle).toBe(0);
    expect(dryRunLines(spy)).toEqual([]);
  });

  it("sends for real to members it's live for and only logs the rest, in the same pass", async () => {
    const now = sendTime("m1", "intro_nudge");
    // Both are due at the same hour; m2's send hour is made to match m1's by choosing members that share it.
    const sameHour = ["m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"].find(
      (id) => sendHourFor(`${id}:intro_nudge:0`) === sendHourFor("m1:intro_nudge:0")
    )!;
    setup({ members: [member("m1", joinedDaysBefore(now, 10)), member(sameHour, joinedDaysBefore(now, 10))] });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await sendMemberReminders(repos, now, { liveFor: async () => new Set(["m1"]) });

    expect(result).toEqual({ intro: 1, prickle: 0, dryRun: { intro: 1, prickle: 0 } });
    expect(slackTargets()).toEqual(["U-m1"]);
    expect(dataset.reminderLog.map((r) => r.memberId)).toEqual(["m1"]);
    expect(dryRunLines(spy).map((l) => l.memberId)).toEqual([sameHour]);
  });
});

describe("the reminder feature flags", () => {
  const request = () =>
    new NextRequest("http://localhost/api/internal/member-reminders", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    });
  /** The reminder flags, exactly these keys switched on globally. */
  const flagsOn = (...keys: string[]) => ["intro_reminders", "prickle_reminders"].map((k) => flag(k, keys.includes(k)));

  async function runRoute(seed: Seed, memberKind: "intro" | "prickle" = "intro") {
    const now = memberKind === "intro" ? sendTime("m1", "intro_nudge") : sendTime("m1", "prickle_nudge");
    const joined = memberKind === "intro" ? joinedDaysBefore(now, 10) : "2022-03-01";
    setup({ members: [member("m1", joined, "u1")], ...seed });
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
    const { body, spy } = await runRoute({ featureFlags: flagsOn() });

    expect(body).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 1, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(spy.mock.calls.some((c) => String(c[0]).includes("DRY RUN intro_nudge"))).toBe(true);
  });

  it("sends intro reminders for real once intro_reminders is on globally", async () => {
    const { body } = await runRoute({ featureFlags: flagsOn("intro_reminders") });

    expect(body).toEqual({ intro: 1, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });

  it("keeps intro reminders dry when only prickle_reminders is on", async () => {
    const { body } = await runRoute({ featureFlags: flagsOn("prickle_reminders") });

    expect(body).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 1, prickle: 0 } });
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("keeps prickle reminders dry when only intro_reminders is on, and sends them once prickle_reminders is", async () => {
    const tables = { notificationPreferences: [optIn("m1", "prickle_nudge")] };

    const dry = await runRoute({ ...tables, featureFlags: flagsOn("intro_reminders") }, "prickle");
    expect(dry.body).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 1 } });
    expect(sendSlackDM).not.toHaveBeenCalled();

    const live = await runRoute({ ...tables, featureFlags: flagsOn("prickle_reminders") }, "prickle");
    expect(live.body).toEqual({ intro: 0, prickle: 1, dryRun: { intro: 0, prickle: 0 } });
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });

  it("covers a member with their own preview of that flag even while it's off globally", async () => {
    const { body } = await runRoute({
      featureFlags: flagsOn(),
      userFeaturePreviews: [{ user_id: "u1", feature_key: "intro_reminders", enabled_at: "2026-10-01T00:00:00Z" }],
    });

    expect(body.intro).toBe(1);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });

  it("covers a member without a Hub account when it's on globally (Slack needs none)", async () => {
    const now = sendTime("m1", "intro_nudge");
    setup({ members: [member("m1", joinedDaysBefore(now, 10), null)], featureFlags: flagsOn("intro_reminders") });
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect((await sendMemberReminders(repos, now, {
      liveFor: (_kind, ids) => membersWithFeatureForOutreach(repos, "intro_reminders", ids),
    })).intro).toBe(1);
  });
});

describe("the route", () => {
  const request = (headers: Record<string, string> = {}) =>
    new NextRequest("http://localhost/api/internal/member-reminders", { method: "POST", headers });

  it("rejects a request without the cron secret", async () => {
    setup({ members: [member("m1", "2026-10-01")] });

    expect((await POST(request())).status).toBe(401);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("runs with the secret and reports what it sent", async () => {
    setup({ members: [] });

    const res = await POST(request({ authorization: "Bearer test-secret" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } });
  });
});
