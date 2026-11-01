import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeSupabase, type FakeSupabase, type FakeTables } from "@/tests/helpers/server-page";
import { SLACK_WORKSPACE_URL } from "@/lib/config";

// The tour's state as the member's session builds it: Supabase and the calendar loader faked, so
// what matters is which signals the queries turn into steps.
let userSupabase: FakeSupabase;
let serviceSupabase: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userSupabase }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => serviceSupabase }));

const slack = vi.hoisted(() => ({ configured: false, status: { connected: false, sharesReadState: false, revoked: false }, chatOn: false }));
vi.mock("@/lib/slack-connect", async (orig) => ({
  ...(await orig<typeof import("@/lib/slack-connect")>()),
  isSlackConnectConfigured: () => slack.configured,
  getSlackConnectionStatus: async () => slack.status,
}));
vi.mock("@/lib/features.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/features.server")>()),
  membersWithFeature: async (_s: unknown, key: string, ids: string[]) => new Set(key === "chat" && slack.chatOn ? ids : []),
}));

const upcomingPrickleIds = vi.fn(async (_s: unknown, _memberId: string): Promise<Set<string>> => new Set());
vi.mock("@/lib/calendar-feed", () => ({
  loadCalendarFeedPrickleIds: (s: unknown, memberId: string) => upcomingPrickleIds(s, memberId),
}));

const { getOnboardingState } = await import("@/lib/onboarding.server");

const NOW = new Date("2026-10-13T15:00:00Z");
const NEWCOMER = { first_joined_at: "2026-10-01" };
const VETERAN = { first_joined_at: "2022-03-01" };
const RECORD = { marked_steps: [] as string[], dismissed_at: null, completed_at: null };

function run(tables: FakeTables = {}, { channel = "C-START" as string | null } = {}) {
  userSupabase = createFakeSupabase({ member_onboarding: { data: RECORD }, members: { data: [VETERAN] }, ...tables });
  serviceSupabase = createFakeSupabase({
    "bronze.slack_channels": { data: channel ? [{ channel_id: channel }] : [] },
  });
  return getOnboardingState("m1");
}

const step = (state: Awaited<ReturnType<typeof getOnboardingState>>, id: string) => state.steps.find((s) => s.id === id);

beforeEach(() => {
  slack.configured = false;
  slack.chatOn = false;
  slack.status = { connected: false, sharesReadState: false, revoked: false };
  upcomingPrickleIds.mockReset();
  upcomingPrickleIds.mockResolvedValue(new Set());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe("getOnboardingState for a newcomer", () => {
  it("adds the Slack step, linking to the intro channel", async () => {
    const state = await run({ members: { data: [NEWCOMER] } });

    expect(state.steps.map((s) => s.id)).toEqual(["identity", "profile", "intro", "writing", "prickles", "calendar"]);
    expect(step(state, "intro")).toMatchObject({
      externalHref: `${SLACK_WORKSPACE_URL}/app_redirect?channel=C-START`,
      done: false,
    });
    expect(step(state, "prickles")?.title).toBe("Schedule your first prickle");
  });

  it("leaves the Slack step out when the workspace has no intro channel", async () => {
    const state = await run({ members: { data: [NEWCOMER] } }, { channel: null });

    expect(step(state, "intro")).toBeUndefined();
  });

  it("counts the Slack step done once they've posted in the intro channel", async () => {
    const state = await run({ members: { data: [NEWCOMER] }, member_activities: { data: [{ member_id: "m1" }] } });

    expect(step(state, "intro")?.done).toBe(true);
  });

  it("counts the first-prickle step done when a prickle is on their calendar from now on", async () => {
    upcomingPrickleIds.mockResolvedValue(new Set(["p1"]));
    const state = await run({ members: { data: [NEWCOMER] } });

    expect(step(state, "prickles")?.done).toBe(true);
    expect(upcomingPrickleIds).toHaveBeenCalledWith(expect.anything(), "m1");
  });

  it("counts it done once they've attended one, even with nothing coming up", async () => {
    const state = await run({ members: { data: [NEWCOMER] }, prickle_attendance: { data: [{ member_id: "m1" }] } });

    expect(step(state, "prickles")).toMatchObject({ title: "Join a prickle", done: true });
  });
});

describe("getOnboardingState for everyone else", () => {
  it("has no Slack step and the usual prickles step for a member past their first 90 days", async () => {
    const state = await run();

    expect(step(state, "intro")).toBeUndefined();
    expect(step(state, "prickles")).toMatchObject({ title: "Join a prickle", done: false });
    expect(serviceSupabase.queries.some((q) => q.table === "bronze.slack_channels")).toBe(false);
  });

  it("counts the calendar step done once a calendar app has fetched their feed", async () => {
    const synced = await run({ calendar_feed_tokens: { data: { first_fetched_at: "2026-10-10T00:00:00Z" } } });
    expect(step(synced, "calendar")?.done).toBe(true);

    const notYet = await run({ calendar_feed_tokens: { data: { first_fetched_at: null } } });
    expect(step(notYet, "calendar")?.done).toBe(false);
  });

  it("reads a failed calendar lookup as nothing done, and the checklist still renders", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = await run({
      calendar_feed_tokens: { data: null, error: { message: "database is down" } },
      calendar_feed_items: { data: null, error: { message: "database is down" } },
    });

    expect(step(state, "calendar")?.done).toBe(false);
    expect(log).toHaveBeenCalledWith("onboarding: failed to read the calendar feed", expect.any(Error));
    expect(log).toHaveBeenCalledWith("onboarding: failed to count calendar items", expect.any(Error));
    log.mockRestore();
  });

  it("skips every other read once the tour is dismissed", async () => {
    const state = await run({ member_onboarding: { data: { ...RECORD, dismissed_at: "2026-10-01T00:00:00Z" } } });

    expect(state.active).toBe(false);
    expect(userSupabase.queries.map((q) => q.table)).toEqual(["member_onboarding"]);
  });
});

describe("the Slack step's signals", () => {
  it("is offered, and required, to a member who has chat, and done only with a connection that has every scope", async () => {
    slack.configured = true;
    slack.chatOn = true;
    const required = step(await run(), "slack");
    expect(required?.done).toBe(false);
    expect(required?.confirmLabel).toBeUndefined();

    slack.status = { connected: true, sharesReadState: false, revoked: false };
    expect(step(await run(), "slack")?.done).toBe(false); // made before the scopes it needs now: reconnect

    slack.status = { connected: true, sharesReadState: true, revoked: false };
    expect(step(await run(), "slack")?.done).toBe(true);
  });

  it("is optional for a member without chat, and absent when Slack isn't configured", async () => {
    slack.configured = true;
    expect(step(await run(), "slack")).toMatchObject({ done: false, confirmLabel: "I'll skip this" });

    slack.configured = false;
    expect(step(await run(), "slack")).toBeUndefined();
  });
});
