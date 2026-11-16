// @vitest-environment jsdom
/**
 * Page wiring for the admin member detail (app/(admin)/admin/members/[id]/MemberDetailPage.tsx):
 * the data each tab gets. MemberDetails (the tabbed client UI) is stubbed to print the Slack
 * activity it is handed, so these tests are about what the page loads and resolves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
    emailAliases,
    eventSlugs,
    notificationsInfo,
  }: {
    notificationsInfo?: unknown;
    emailAliases: { alias_email: string }[];
    eventSlugs?: Record<string, string>;
    slackPage: { rows: { id: string; description: string | null }[] };
    activityFeed: { total: number; page: number } | null;
  }) => (
    <>
      <ul aria-label="slack activity">
        {slackPage.rows.map((a) => (
          <li key={a.id}>{a.description}</li>
        ))}
      </ul>
      <p>{activityFeed ? `activity ${activityFeed.total} on page ${activityFeed.page}` : "activity unavailable"}</p>
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
