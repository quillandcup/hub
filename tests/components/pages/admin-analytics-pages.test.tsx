// @vitest-environment jsdom
/** The admin usage pages: Feature Usage (funnels, most-clicked, all events) and the explorer. The data comes from the fake client's rpc entries; the markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks, useFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));
// The builder is a client component with a server action; the page's wiring is what is under test.
vi.mock("@/app/(admin)/admin/analytics/explore/ExploreForm", () => ({
  ExploreForm: (props: { initialSteps: unknown[]; initialBreakdown: unknown; initialDays: number }) => (
    <div data-testid="form" data-days={props.initialDays} data-steps={JSON.stringify(props.initialSteps)} data-breakdown={JSON.stringify(props.initialBreakdown)} />
  ),
}));

import FeatureUsagePage from "@/app/(admin)/admin/analytics/page";
import ExploreUsagePage from "@/app/(admin)/admin/analytics/explore/page";

const rpcCalls = (supabase: ReturnType<typeof useFakeSupabase>, fn: string) =>
  supabase.queries.filter((q) => q.table === `rpc:${fn}`).map((q) => q.calls.find((c) => c.method === "args")!.args);

beforeEach(() => {
  resetServerPageMocks();
  requireAdminPage.mockClear();
});

describe("/admin/analytics", () => {
  const summary = [
    { event: "onair_popover_opened", events: 12, members: 4, sessions: 9, last_seen: "2026-11-13T12:00:00Z" },
    { event: "page_viewed", events: 80, members: 6, sessions: 30, last_seen: "2026-11-13T12:30:00Z" },
  ];
  const clicks = [
    { label: "Join on Zoom", element: "link", events: 7, members: 3, sessions: 5, routes: 2 },
    { label: "(unlabelled)", element: "input", events: 4, members: 1, sessions: 2, routes: 1 },
  ];

  function funnelFor(query: FakeQuery) {
    const args = query.calls.find((c) => c.method === "args")!.args[0] as { filters: { live: boolean }[] };
    return { data: args.filters[0].live ? [{ sessions: 10 }, { sessions: 4 }] : [{ sessions: 5 }, { sessions: 0 }] };
  }

  it("counts staff and leaves out sudo by default, and passes the filters to every query", async () => {
    const supabase = useFakeSupabase();
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });
    for (const fn of ["analytics_event_summary", "analytics_top_clicks", "analytics_control_rates", "analytics_action_outcomes", "analytics_notification_rates", "analytics_funnel"]) {
      for (const [args] of rpcCalls(supabase, fn)) expect(args).toMatchObject({ ignore_staff: false, ignore_sudo: true });
    }
    expect(screen.getByRole("link", { name: /Ignore staff in sudo/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("applies ignore-staff and include-sudo from the address, and keeps them in the window links and forms", async () => {
    const supabase = useFakeSupabase();
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({ staff: "hide", sudo: "show", days: "7" }) });
    for (const fn of ["analytics_event_summary", "analytics_top_clicks", "analytics_control_rates", "analytics_action_outcomes", "analytics_notification_rates", "analytics_funnel"]) {
      for (const [args] of rpcCalls(supabase, fn)) expect(args).toMatchObject({ ignore_staff: true, ignore_sudo: false });
    }
    const window = new URL(screen.getByRole("link", { name: "Last 30 days" }).getAttribute("href")!, "http://x").searchParams;
    expect(window.get("staff")).toBe("hide");
    expect(window.get("sudo")).toBe("show");
    for (const form of document.querySelectorAll("form")) {
      expect(form.querySelector('input[type="hidden"][name="staff"]')).toHaveValue("hide");
      expect(form.querySelector('input[type="hidden"][name="sudo"]')).toHaveValue("show");
    }
  });

  it("checks the caller is an admin first", async () => {
    useFakeSupabase();
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });
    expect(requireAdminPage).toHaveBeenCalled();
  });

  it("links to the explorer", async () => {
    useFakeSupabase();
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });
    expect(screen.getByRole("link", { name: /Explore/ })).toHaveAttribute("href", "/admin/analytics/explore");
  });

  it("shows the funnels, the most-clicked things and every event", async () => {
    useFakeSupabase({
      "rpc:analytics_event_summary": { data: summary },
      "rpc:analytics_top_clicks": { data: clicks },
      "rpc:analytics_funnel": funnelFor,
    });
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });

    expect(screen.getByRole("heading", { name: "On air light: someone is at the table" })).toBeInTheDocument();
    expect(screen.getByText("4 visits (40% of step 1)")).toBeInTheDocument();
    expect(screen.getByText("0 visits (0% of step 1)")).toBeInTheDocument();

    const clicked = within(screen.getByRole("heading", { name: "Most-clicked things" }).closest("section")!);
    expect(clicked.getByText("Join on Zoom")).toBeInTheDocument();
    expect(clicked.getByText("(unlabelled)")).toBeInTheDocument();
    expect(clicked.getByRole("row", { name: /Join on Zoom link 7 3 5 2/ })).toBeInTheDocument();

    const events = within(screen.getByRole("heading", { name: "All events" }).closest("section")!);
    expect(events.getByText("onair_popover_opened")).toBeInTheDocument();
    expect(events.getByText("80")).toBeInTheDocument();
  });

  it("hides the admin area from the clicks by default, and shows it when asked", async () => {
    let supabase = useFakeSupabase();
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });
    expect(rpcCalls(supabase, "analytics_top_clicks")[0][0]).toMatchObject({ hide_admin: true, route_prefix: null });

    cleanup();
    resetServerPageMocks();
    supabase = useFakeSupabase();
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({ admin: "show", route: " /courses ", days: "7" }) });
    expect(rpcCalls(supabase, "analytics_top_clicks")[0][0]).toMatchObject({ hide_admin: false, route_prefix: "/courses" });
    expect(screen.getByLabelText("Include admin pages")).toBeChecked();
    expect(screen.getByPlaceholderText("/courses")).toHaveValue("/courses");
  });

  it("keeps the page filter when the window changes", async () => {
    useFakeSupabase();
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({ route: "/courses", admin: "show" }) });
    const link = screen.getByRole("link", { name: "Last 90 days" });
    expect(new URL(link.getAttribute("href")!, "http://x").searchParams.toString()).toBe("days=90&route=%2Fcourses&admin=show");
  });

  describe("least-clicked controls", () => {
    const old = "2026-01-01T00:00:00Z";
    const rates = [
      { name: "export-csv", seen_sessions: 40, seen_members: 12, clicked_sessions: 1, clicked_members: 1, first_seen: old },
      { name: "save-goal", seen_sessions: 20, seen_members: 9, clicked_sessions: 10, clicked_members: 8, first_seen: old },
      { name: "tiny-sample", seen_sessions: 3, seen_members: 3, clicked_sessions: 0, clicked_members: 0, first_seen: old },
      { name: "just-shipped", seen_sessions: 50, seen_members: 20, clicked_sessions: 0, clicked_members: 0, first_seen: new Date().toISOString() },
    ];

    const section = () => within(screen.getByRole("heading", { name: "Least-clicked controls" }).closest("section")!);

    it("shows click-through for controls with enough visits and age, lowest first, and says how many are held back", async () => {
      useFakeSupabase({ "rpc:analytics_control_rates": { data: rates } });
      await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });

      const rows = section().getAllByRole("row").slice(1);
      expect(rows.map((r) => r.textContent)).toEqual([
        expect.stringContaining("export-csv3%1 / 40"),
        expect.stringContaining("save-goal50%10 / 20"),
      ]);
      expect(section().queryByText("tiny-sample")).toBeNull();
      expect(section().queryByText("just-shipped")).toBeNull();
      expect(section().getByText("2 controls are held back: seen by fewer than 10 visits, or first seen less than 14 days ago.")).toBeInTheDocument();
    });

    it("lets the thresholds be changed, and passes the page filters on", async () => {
      const supabase = useFakeSupabase({ "rpc:analytics_control_rates": { data: rates } });
      await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({ min: "1", age: "0", route: "/courses", admin: "show" }) });

      expect(section().getByText("tiny-sample")).toBeInTheDocument();
      expect(section().getByText("just-shipped")).toBeInTheDocument();
      expect(section().getByRole("row", { name: /just-shipped 0% 0 \/ 50/ })).toBeInTheDocument();
      expect(section().queryByText(/ held back: seen by fewer/)).toBeNull();
      expect(rpcCalls(supabase, "analytics_control_rates")[0][0]).toMatchObject({ route_prefix: "/courses", hide_admin: false });
      expect(screen.getByDisplayValue("1")).toBeInTheDocument();
    });

    it("falls back to the defaults for nonsense thresholds", async () => {
      useFakeSupabase({ "rpc:analytics_control_rates": { data: rates } });
      await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({ min: "-5", age: "soon" }) });
      expect(section().getByText(/fewer than 10 visits, or first seen less than 14 days ago/)).toBeInTheDocument();
    });

    it("explains an empty table", async () => {
      useFakeSupabase();
      await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });
      expect(section().getByText("No control has been seen by 10+ visits and for 14+ days yet.")).toBeInTheDocument();
    });
  });

  describe("actions and notifications", () => {
    const section = (name: string) => within(screen.getByRole("heading", { name }).closest("section")!);

    it("shows what server actions did, with a success rate, and flags the ones that fail often", async () => {
      useFakeSupabase({
        "rpc:analytics_action_outcomes": {
          data: [
            { action: "progress_logged", attempts: 20, succeeded: 19, failed: 1, members: 8 },
            { action: "book_added", attempts: 10, succeeded: 4, failed: 6, members: 3 },
            { action: "wheel_spun", attempts: 5, succeeded: 5, failed: 0, members: 2 },
          ],
        },
      });
      await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });
      const actions = section("Actions: did they work?");
      expect(actions.getByRole("row", { name: /progress_logged 20 19 1 95% 8/ })).toBeInTheDocument();
      expect(actions.getByRole("row", { name: /book_added 10 4 6 40% 3/ })).toBeInTheDocument();
      expect(actions.getByText("40%")).toHaveClass("text-red-600");
      expect(actions.getByText("95%")).not.toHaveClass("text-red-600");
      expect(actions.getByText("100%")).not.toHaveClass("text-red-600");
    });

    it("shows sends and opens per kind and channel with an open rate, and never more than 100%", async () => {
      useFakeSupabase({
        "rpc:analytics_notification_rates": {
          data: [
            { kind: "prickle_checkin", channel: "slack", sent: 40, sent_members: 12, opened: 10, opened_members: 8 },
            { kind: "prickle_checkin", channel: "email", sent: 10, sent_members: 10, opened: 0, opened_members: 0 },
            { kind: "streak_nudge", channel: "in_app", sent: 3, sent_members: 3, opened: 5, opened_members: 3 },
            { kind: "never_sent", channel: "push", sent: 0, sent_members: 0, opened: 2, opened_members: 1 },
          ],
        },
      });
      await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });
      const notifications = section("Notifications: sent and opened");
      expect(notifications.getByRole("row", { name: /prickle_checkin slack 40 10 25% 12/ })).toBeInTheDocument();
      expect(notifications.getByRole("row", { name: /prickle_checkin email 10 0 0% 10/ })).toBeInTheDocument();
      // An open whose send fell before the window can't push the rate past 100%.
      expect(notifications.getByRole("row", { name: /streak_nudge in_app 3 5 100% 3/ })).toBeInTheDocument();
      expect(notifications.getByRole("row", { name: /never_sent push 0 2 – 0/ })).toBeInTheDocument();
    });

    it("says so when there is nothing yet", async () => {
      useFakeSupabase();
      await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });
      expect(section("Actions: did they work?").getByText("No actions recorded in this window.")).toBeInTheDocument();
      expect(section("Notifications: sent and opened").getByText("No notifications recorded in this window.")).toBeInTheDocument();
    });
  });

  it("says so when there is nothing yet, and shows an error from the database", async () => {
    useFakeSupabase({ "rpc:analytics_top_clicks": { data: [], error: { message: "boom" } } });
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({}) });
    expect(screen.getByText("No clicks in this window.")).toBeInTheDocument();
    expect(screen.getByText("No events yet in this window.")).toBeInTheDocument();
    expect(screen.getByText("Could not load usage: boom")).toBeInTheDocument();
  });
});

describe("/admin/analytics/explore", () => {
  it("checks the caller is an admin first", async () => {
    useFakeSupabase();
    await renderServerPage(ExploreUsagePage, { searchParams: Promise.resolve({}) });
    expect(requireAdminPage).toHaveBeenCalled();
  });

  it("passes the who-to-count filters to the funnel and the breakdown, and on to the form", async () => {
    const supabase = useFakeSupabase();
    await renderServerPage(ExploreUsagePage, {
      searchParams: Promise.resolve({ step: "page_viewed", breakdown: "page_viewed.route", staff: "hide" }),
    });
    expect(rpcCalls(supabase, "analytics_funnel")[0][0]).toMatchObject({ ignore_staff: true, ignore_sudo: true });
    expect(rpcCalls(supabase, "analytics_property_breakdown")[0][0]).toMatchObject({ ignore_staff: true, ignore_sudo: true });
    expect(screen.getByRole("link", { name: /Ignore staff$/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("asks nothing of the database until there is a question", async () => {
    const supabase = useFakeSupabase();
    await renderServerPage(ExploreUsagePage, { searchParams: Promise.resolve({}) });
    expect(supabase.queries).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Funnel" })).toBeNull();
    expect(screen.getByTestId("form")).toHaveAttribute("data-days", "30");
  });

  it("runs the funnel from the address and labels each step with its filters", async () => {
    const supabase = useFakeSupabase({ "rpc:analytics_funnel": { data: [{ sessions: 8 }, { sessions: 2 }] } });
    await renderServerPage(ExploreUsagePage, {
      searchParams: Promise.resolve({ days: "7", step: ["onair_popover_opened:live=false", "onair_join_clicked", "made_up"] }),
    });

    expect(rpcCalls(supabase, "analytics_funnel")[0][0]).toMatchObject({
      steps: ["onair_popover_opened", "onair_join_clicked"],
      filters: [{ live: false }, {}],
    });
    expect(screen.getByText("onair_popover_opened (live = false)")).toBeInTheDocument();
    expect(screen.getByText("onair_join_clicked")).toBeInTheDocument();
    expect(screen.getByText("2 visits (25% of step 1)")).toBeInTheDocument();
    expect(screen.getByTestId("form")).toHaveAttribute("data-days", "7");
  });

  it("runs the breakdown with its own filters, not the funnel's", async () => {
    const supabase = useFakeSupabase({
      "rpc:analytics_property_breakdown": {
        data: [
          { value: "Settings", events: 6, members: 1, sessions: 1 },
          { value: null, events: 41, members: 1, sessions: 6 },
        ],
      },
    });
    await renderServerPage(ExploreUsagePage, {
      searchParams: Promise.resolve({ step: "element_clicked:element=input", breakdown: "element_clicked.text", bfilter: "element=button" }),
    });

    expect(rpcCalls(supabase, "analytics_property_breakdown")[0][0]).toMatchObject({
      event_name: "element_clicked",
      property: "text",
      filter: { element: "button" },
    });
    expect(screen.getByRole("heading", { name: "element_clicked by text" })).toBeInTheDocument();
    expect(screen.getByText("Only where element = button.")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("(not set)")).toBeInTheDocument();
  });

  it("says so when a breakdown finds nothing, and shows a database error", async () => {
    useFakeSupabase({ "rpc:analytics_property_breakdown": { data: [], error: { message: "boom" } } });
    await renderServerPage(ExploreUsagePage, { searchParams: Promise.resolve({ breakdown: "page_viewed.route" }) });
    expect(screen.getByText("Could not load usage: boom")).toBeInTheDocument();

    cleanup();
    resetServerPageMocks();
    useFakeSupabase({ "rpc:analytics_property_breakdown": { data: [] } });
    await renderServerPage(ExploreUsagePage, { searchParams: Promise.resolve({ breakdown: "page_viewed.route" }) });
    expect(screen.getByText("No events in this window.")).toBeInTheDocument();
  });
});
