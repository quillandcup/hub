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
    expect(screen.getByDisplayValue("/courses")).toBeInTheDocument();
  });

  it("keeps the page filter when the window changes", async () => {
    useFakeSupabase();
    await renderServerPage(FeatureUsagePage, { searchParams: Promise.resolve({ route: "/courses", admin: "show" }) });
    const link = screen.getByRole("link", { name: "Last 90 days" });
    expect(new URL(link.getAttribute("href")!, "http://x").searchParams.toString()).toBe("days=90&route=%2Fcourses&admin=show");
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
