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
  default: ({ slackActivities }: { slackActivities: { id: string; description: string | null }[] }) => (
    <ul aria-label="slack activity">
      {slackActivities.map((a) => (
        <li key={a.id}>{a.description}</li>
      ))}
    </ul>
  ),
}));
vi.mock("@/app/(admin)/admin/members/[id]/MergeButton", () => ({ default: () => null }));
vi.mock("@/app/actions/sudo", () => ({ startSudo: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn(async () => "UTC") }));
vi.mock("@/lib/badges", () => ({ getMemberBadges: vi.fn(async () => []) }));
vi.mock("@/lib/kajabi/membership-history", () => ({ fetchMembershipHistory: vi.fn(async () => []) }));
vi.mock("@/lib/channels/web-push", () => ({ loadPushDevices: vi.fn(async () => []) }));

import MemberDetailPage from "@/app/(admin)/admin/members/[id]/MemberDetailPage";

const MEMBER = { id: "member-moss", name: "Moss Bramble", email: "moss.bramble@example.test", kajabi_id: null, stripe_customer_id: null };

function memberTables(extra: FakeTables = {}): FakeTables {
  return { members: { data: [MEMBER] }, ...extra };
}

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  serviceTables = {
    "public.chat_slack_authors": { data: [] },
    "bronze.slack_users": { data: [{ user_id: "U1", display_name: "Fern", real_name: "Fern Quillsby", name: "fern" }] },
    "bronze.slack_channels": { data: [{ channel_id: "C1", name: "hub-feedback" }] },
  };
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
});
