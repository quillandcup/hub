// @vitest-environment jsdom
/**
 * Page wiring for the admin member detail (src/app/(admin)/admin/members/[id]/MemberDetailPage.tsx):
 * the data each tab gets. MemberDetails (the tabbed client UI) is stubbed to print the Slack
 * activity it is handed, so these tests are about what the page loads and resolves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  ADMIN_USER,
  createFakeSupabase,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
  type FakeTables,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

// Service-role reads (Slack names, push devices) go to a second fake client the tests can fill.
let serviceTables: FakeTables = {};
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => createFakeSupabase(serviceTables) }));

vi.mock("@/app/(admin)/admin/members/[id]/MemberDetails", () => ({
  default: ({
    slackPage,
    activityFeed,
    activityFilters,
    emailAliases,
    eventSlugs,
    notificationsInfo,
  }: {
    notificationsInfo?: unknown;
    emailAliases: { alias_email: string }[];
    eventSlugs?: Record<string, string>;
    slackPage: { rows: { id: string; description: string | null }[] };
    activityFeed: { total: number; page: number } | null;
    activityFilters: unknown;
  }) => (
    <>
      <ul aria-label="slack activity">
        {slackPage.rows.map((a) => (
          <li key={a.id}>{a.description}</li>
        ))}
      </ul>
      <p>{activityFeed ? `activity ${activityFeed.total} on page ${activityFeed.page}` : "activity unavailable"}</p>
      <p data-testid="activity-filters">{JSON.stringify(activityFilters ?? null)}</p>
      <p data-testid="notifications-info">{JSON.stringify(notificationsInfo ?? null)}</p>
      <p>{`event slugs ${JSON.stringify(eventSlugs ?? {})}`}</p>
      <ol aria-label="email aliases">
        {emailAliases.map((a) => (
          <li key={a.alias_email}>{a.alias_email}</li>
        ))}
      </ol>
    </>
  ),
}));
vi.mock("@/app/(admin)/admin/members/[id]/MergeButton", () => ({ default: () => null }));
const staff = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => ({})), requireStaffPage: vi.fn(async () => ({ id: "admin", email: "a@example.test", role: staff.role })) }));
vi.mock("@/app/actions/sudo", () => ({ startSudo: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn(async () => "UTC") }));
vi.mock("@/lib/badges", () => ({ getMemberBadges: vi.fn(async () => []) }));
vi.mock("@/lib/kajabi/membership-history", () => ({ fetchMembershipHistory: vi.fn(async () => []) }));

vi.mock("@/lib/channels/web-push", () => ({ loadPushDevices: vi.fn(async () => []) }));
import { loadPushDevices } from "@/lib/channels/web-push";
import ActivityRoute, { generateMetadata as activityMetadata } from "@/app/(admin)/admin/members/[id]/activity/page";
import { COMMUNITY_MANAGER_FEATURES, type StaffFeature } from "@/lib/staff-access";
import AccountRoute, { generateMetadata as accountMetadata } from "@/app/(admin)/admin/members/[id]/account/page";
import NotificationsRoute, { generateMetadata as notificationsMetadata } from "@/app/(admin)/admin/members/[id]/notifications/page";
import { getMemberBadges } from "@/lib/badges";
import MemberDetailPage, { memberTabMetadata } from "@/app/(admin)/admin/members/[id]/MemberDetailPage";

const MEMBER = { id: "member-moss", name: "Moss Bramble", email: "moss.bramble@example.test", kajabi_id: null, stripe_customer_id: null };

function memberTables(extra: FakeTables = {}): FakeTables {
  return { members: { data: [MEMBER] }, ...extra };
}

beforeEach(() => {
  staff.role = "admin";
  vi.mocked(loadPushDevices).mockClear();
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  serviceTables = {
    "public.chat_slack_authors": { data: [] },
    "bronze.slack_users": { data: [{ user_id: "U1", display_name: "Fern", real_name: "Fern Quillsby", name: "fern" }] },
    "bronze.slack_channels": { data: [{ channel_id: "C1", name: "hub-feedback" }] },
  };
});

describe("MemberDetailPage controls", () => {
  it("gives an admin Sudo As and Remove member", async () => {
    useFakeSupabase(memberTables());
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const });
    expect(screen.getByRole("button", { name: "Sudo As" })).toBeInTheDocument();
  });

  it("shows an admin the Notifications tab: devices, email and choices against defaults", async () => {
    vi.mocked(loadPushDevices).mockResolvedValue([{ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" }] as never);
    useFakeSupabase(memberTables({ notification_preferences: { data: [{ kind: "prickle_checkin", channel: "slack", enabled: false }] } }));
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "notifications" as const });
    const info = JSON.parse(screen.getByTestId("notifications-info").textContent!);
    expect(info.devices).toHaveLength(1);
    const checkin = info.kinds.find((k: { id: string }) => k.id === "prickle_checkin");
    expect(checkin.channels).not.toContain("slack");
    expect(checkin.changed).toEqual(["slack"]);
    vi.mocked(loadPushDevices).mockResolvedValue([]);
  });

  it("shows no devices and no stored choices, rather than failing, when either lookup errors", async () => {
    vi.mocked(loadPushDevices).mockRejectedValueOnce(new Error("push table down"));
    useFakeSupabase(memberTables({ notification_preferences: { data: null, error: { message: "prefs down" } } }));
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "notifications" as const });
    const info = JSON.parse(screen.getByTestId("notifications-info").textContent!);
    expect(info.devices).toEqual([]);
    expect(info.kinds.every((k: { changed: string[] }) => k.changed.length === 0)).toBe(true);
  });

  it("serves the Notifications tab at its own route, titled for the tab", async () => {
    useFakeSupabase(memberTables());
    const params = Promise.resolve({ id: MEMBER.id });
    expect(String((await notificationsMetadata({ params })).title)).toContain("Notifications");
    const element = await NotificationsRoute({ params } as never);
    expect(element.props).toMatchObject({ id: MEMBER.id, tab: "notifications" });
  });

  it("serves the Account tab at its own route, titled for the tab", async () => {
    useFakeSupabase(memberTables());
    const params = Promise.resolve({ id: MEMBER.id });
    expect(String((await accountMetadata({ params })).title)).toContain("Account");
    const element = await AccountRoute({ params } as never);
    expect(element.props).toMatchObject({ id: MEMBER.id, tab: "account" });
  });

  it("hides the Notifications tab and its data from a community manager", async () => {
    staff.role = "community_manager";
    useFakeSupabase(memberTables());
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "notifications" as const });
    expect(screen.getByTestId("notifications-info")).toHaveTextContent("null");
    expect(loadPushDevices).not.toHaveBeenCalled();
  });

  it("gives a community manager the profile without Sudo As, Merge, Split or the Remove panel", async () => {
    staff.role = "community_manager";
    useFakeSupabase(memberTables());
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const });
    expect(screen.getByRole("heading", { name: "Moss Bramble" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sudo As" })).not.toBeInTheDocument();
    expect(screen.queryByText(/remove member/i)).not.toBeInTheDocument();
  });
});

describe("MemberDetailPage", () => {
  it("sends a signed-out visitor to login", async () => {
    signInAs(null);
    await expectRedirect(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const }, "/login");
  });

  it("shows Slack mentions in activity descriptions as names, not Slack ids", async () => {
    useFakeSupabase(
      memberTables({
        member_activities: (query) =>
          query.calls.some((c) => c.method === "eq" && c.args[0] === "source")
            ? { data: [{ id: "a1", source: "slack", description: "<@U1> thanks, see <#C1|channel>" }] }
            : { data: [] },
      })
    );
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "slack" as const });
    expect(screen.getByRole("heading", { name: "Moss Bramble" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["@Fern thanks, see #hub-feedback"]);
  });

  it("loads the Slack rows on every tab, since tabs switch on the client", async () => {
    useFakeSupabase(
      memberTables({
        member_activities: (query) =>
          query.calls.some((c) => c.method === "eq" && c.args[0] === "source")
            ? { data: [{ id: "a1", source: "slack", description: "hello" }] }
            : { data: [] },
      })
    );
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const });
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["hello"]);
  });

  it("hands the member's event-linked badges the address of their event", async () => {
    vi.mocked(getMemberBadges).mockResolvedValueOnce([
      { badgeType: { id: "bt1", event_id: "evt_AAAAAAAAAAA1" }, levelName: "Retreat", level: null, occurrences: 1, firstAwardedAt: null, lastAwardedAt: null, note: null },
      { badgeType: { id: "bt2", event_id: null }, levelName: "Hostess", level: null, occurrences: 1, firstAwardedAt: null, lastAwardedAt: null, note: null },
    ] as never);
    useFakeSupabase(memberTables({ community_event_details: { data: [{ id: "evt_AAAAAAAAAAA1", slug: "spring-retreat-2097-04-10", title: "Spring Retreat" }] } }));
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const });
    expect(screen.getByText('event slugs {"evt_AAAAAAAAAAA1":"spring-retreat-2097-04-10"}')).toBeInTheDocument();
  });

  it("still renders when an earned badge's event can't be found", async () => {
    vi.mocked(getMemberBadges).mockResolvedValueOnce([
      { badgeType: { id: "bt1", event_id: "evt_GONE00000001" }, levelName: "Retreat", level: null, occurrences: 1, firstAwardedAt: null, lastAwardedAt: null, note: null },
    ] as never);
    useFakeSupabase(memberTables({ community_event_details: { data: [] } }));
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const });
    expect(screen.getByText("event slugs {}")).toBeInTheDocument();
  });

  it("still renders when reading an earned badge's event fails", async () => {
    vi.mocked(getMemberBadges).mockResolvedValueOnce([
      { badgeType: { id: "bt1", event_id: "evt_AAAAAAAAAAA1" }, levelName: "Retreat", level: null, occurrences: 1, firstAwardedAt: null, lastAwardedAt: null, note: null },
    ] as never);
    useFakeSupabase(memberTables({ community_event_details: { data: null, error: { message: "timed out" } } }));
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const });
    expect(screen.getByText("event slugs {}")).toBeInTheDocument();
  });

  it("lists the member's email aliases by address", async () => {
    useFakeSupabase(
      memberTables({
        member_email_aliases: {
          data: [
            { id: "e1", alias_email: "zed@example.test", source: "manual", active: true, created_at: "2026-02-01T00:00:00Z" },
            { id: "e2", alias_email: "ada@example.test", source: "manual", active: true, created_at: "2026-01-01T00:00:00Z" },
            { id: "e3", alias_email: "ada@example.test", source: "manual", active: false, created_at: "2026-03-01T00:00:00Z" },
          ],
        },
      })
    );
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const });
    const aliases = screen.getByRole("list", { name: "email aliases" });
    expect(Array.from(aliases.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["ada@example.test", "ada@example.test", "zed@example.test"]);
  });

  it("loads the member's own activity feed for the Activity Log tab", async () => {
    const supabase = useFakeSupabase(
      memberTables({
        "rpc:count_activity_feed": { data: 1 },
        "rpc:get_activity_feed": { data: [{ event_id: "e1", kind: "activity", description: null }] },
      })
    );
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "activity" as const, searchParams: { page: "1" } });
    expect(screen.getByText("activity 1 on page 1")).toBeInTheDocument();
    const feedCall = supabase.queries
      .filter((q) => q.table === "rpc:get_activity_feed")
      .flatMap((q) => q.calls)
      .find((c) => c.method === "args");
    expect(feedCall?.args[0]).toMatchObject({ p_member_id: MEMBER.id, p_audit_only: false });
  });

  const feedArgs = (supabase: ReturnType<typeof useFakeSupabase>, rpc: string) =>
    supabase.queries
      .filter((q) => q.table === `rpc:${rpc}`)
      .flatMap((q) => q.calls)
      .find((c) => c.method === "args")?.args[0];

  it("asks for everything for an admin, and for the member's activity only for a community manager", async () => {
    const tables = memberTables({
      "rpc:count_activity_feed": { data: 1 },
      "rpc:get_activity_feed": { data: [{ event_id: "e1", kind: "activity", description: null }] },
    });
    const admin = useFakeSupabase(tables);
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "activity" as const, searchParams: { view: "privacy", kinds: "audit" } });
    expect(feedArgs(admin, "get_activity_feed")).toMatchObject({ p_member_id: MEMBER.id, p_kinds: ["audit"], p_entity_types: expect.any(Array) });

    staff.role = "community_manager";
    const manager = useFakeSupabase(tables);
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "activity" as const, searchParams: { view: "privacy", kinds: "audit", actor: "00000000-0000-4000-8000-000000000001" } });
    expect(screen.getAllByText("activity 1 on page 1").length).toBeGreaterThan(0);
    expect(feedArgs(manager, "get_activity_feed")).toMatchObject({ p_member_id: MEMBER.id, p_kinds: ["activity"], p_entity_types: null, p_actor_user_id: null, p_audit_only: false });
    expect(feedArgs(manager, "count_activity_feed")).toMatchObject({ p_kinds: ["activity"], p_entity_types: null });
  });

  describe("the Activity tab's date range", () => {
    const tables = () =>
      memberTables({
        "rpc:count_activity_feed": { data: 30 },
        "rpc:get_activity_feed": { data: [{ event_id: "e1", kind: "activity", description: null }] },
      });
    const filtersShown = () => JSON.parse(screen.getByTestId("activity-filters").textContent ?? "null");

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-17T15:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    it.each([
      ["an admin", "admin"],
      ["a community manager", "community_manager"],
    ])("asks the count and the page for the same Eastern days for %s, with the whole To day in it", async (_who, role) => {
      staff.role = role;
      const supabase = useFakeSupabase(tables());
      await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "activity" as const, searchParams: { from: "2026-11-01", to: "2026-11-01", page: "2" } });
      const window = { p_from: "2026-11-01T04:00:00.000Z", p_to: "2026-11-02T05:00:00.000Z", p_member_id: MEMBER.id };
      expect(feedArgs(supabase, "count_activity_feed")).toMatchObject(window);
      expect(feedArgs(supabase, "get_activity_feed")).toMatchObject({ ...window, p_offset: 0 });
      expect(filtersShown()).toMatchObject({ range: { from: "2026-11-01", to: "2026-11-01" }, rangeNotice: null });
    });

    it("keeps a community manager to the member's own activity rows whatever the range, for all time too", async () => {
      staff.role = "community_manager";
      const supabase = useFakeSupabase(tables());
      await renderServerPage(MemberDetailPage, {
        id: MEMBER.id,
        tab: "activity" as const,
        searchParams: { days: "all", view: "privacy", kinds: "audit", actor: "00000000-0000-4000-8000-000000000001" },
      });
      for (const rpc of ["count_activity_feed", "get_activity_feed"]) {
        expect(feedArgs(supabase, rpc)).toMatchObject({ p_kinds: ["activity"], p_entity_types: null, p_actor_user_id: null, p_audit_only: false, p_from: "2000-01-01T05:00:00.000Z" });
      }
    });

    it.each([
      ["a backwards range", { from: "2026-11-10", to: "2026-11-03" }],
      ["a range that has not begun", { from: "2026-12-01", to: "2026-12-09" }],
      ["garbage", { from: "not-a-date", to: "2026-13-45" }],
      ["a date from the year one", { from: "0001-01-01", to: "2026-11-03" }],
    ])("falls back to the last 90 days with a notice for %s, and still loads the tab", async (_what, searchParams) => {
      const supabase = useFakeSupabase(tables());
      await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "activity" as const, searchParams });
      expect(screen.getByText("activity 30 on page 1")).toBeInTheDocument();
      expect(filtersShown()).toMatchObject({ range: null, days: 90, rangeNotice: expect.stringContaining("so the usual range is shown") });
      expect(feedArgs(supabase, "get_activity_feed")).toMatchObject({ p_from: "2026-08-19T15:00:00.000Z", p_to: "2026-11-17T15:01:00.000Z" });
    });

    it("keeps today's default window when no range is given", async () => {
      const supabase = useFakeSupabase(tables());
      await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "activity" as const, searchParams: {} });
      expect(filtersShown()).toMatchObject({ days: 90 });
      expect(filtersShown().range ?? null).toBeNull();
      expect(feedArgs(supabase, "count_activity_feed")).toMatchObject({ p_from: "2026-08-19T15:00:00.000Z" });
    });
  });

  it("reads no activity feed for a role that has neither Activity tab feature", async () => {
    staff.role = "community_manager";
    const features = COMMUNITY_MANAGER_FEATURES as StaffFeature[];
    const saved = [...features];
    features.splice(0, features.length, "care.write");
    try {
      const supabase = useFakeSupabase(memberTables());
      await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const });
      expect(screen.getByText("activity unavailable")).toBeInTheDocument();
      expect(supabase.queries.some((q) => q.table === "rpc:get_activity_feed" || q.table === "rpc:count_activity_feed")).toBe(false);
    } finally {
      features.splice(0, features.length, ...saved);
    }
  });

  it("serves the Activity tab at its own route for an admin and a community manager, and sends one without the feature to the Overview", async () => {
    useFakeSupabase(memberTables());
    const params = Promise.resolve({ id: MEMBER.id });
    expect(String((await activityMetadata({ params })).title)).toContain("Activity Log");
    const searchParams = Promise.resolve({});
    expect((await ActivityRoute({ params, searchParams } as never)).props).toMatchObject({ id: MEMBER.id, tab: "activity" });

    staff.role = "community_manager";
    expect((await ActivityRoute({ params, searchParams } as never)).props).toMatchObject({ id: MEMBER.id, tab: "activity" });

    const features = COMMUNITY_MANAGER_FEATURES as StaffFeature[];
    const saved = [...features];
    features.splice(0, features.length, "care.write");
    try {
      await expectRedirect(ActivityRoute, { params, searchParams }, `/admin/members/${MEMBER.id}`);
    } finally {
      features.splice(0, features.length, ...saved);
    }
  });

  it("still renders the page when the activity feed query times out", async () => {
    useFakeSupabase(memberTables({ "rpc:count_activity_feed": { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderServerPage(MemberDetailPage, { id: MEMBER.id, tab: "overview" as const });
    expect(screen.getByText("activity unavailable")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "slack activity" })).toBeInTheDocument();
  });

  it("titles the page with the member's display name, then the tab", async () => {
    useFakeSupabase({ members: { data: [{ ...MEMBER, display_name: "Moss B" }] } });
    const params = Promise.resolve({ id: MEMBER.id });
    const overview = await memberTabMetadata("overview")({ params });
    const slack = await memberTabMetadata("slack")({ params });
    expect(String(overview.title)).toContain("Moss B");
    expect(String(overview.title)).not.toContain("Moss Bramble");
    expect(String(slack.title)).toContain("Moss B");
    expect(String(slack.title)).toContain("Slack Activity");
  });

  it("titles the page 'Member' when the member does not exist", async () => {
    useFakeSupabase({ members: { data: [] } });
    const metadata = await memberTabMetadata("overview")({ params: Promise.resolve({ id: "mbr_AAAAAAAAAAA9" }) });
    expect(String(metadata.title)).toContain("Member");
  });
});
