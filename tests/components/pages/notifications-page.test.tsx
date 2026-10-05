// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  notFound,
  resetServerPageMocks,
  routerMock,
  signInAs,
  useFakeSupabase,
  type FakeSupabase,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: vi.fn() }));

const { getUserFeaturePreviews } = await import("@/lib/features.server");
const { default: NotificationsPage } = await import("@/app/(member)/notifications/page");
const { InAppNotificationsProvider } = await import("@/components/InAppNotifications");

const ROWS = [
  { id: "n1", kind: "prickle_checkin", text: "Ready for Progress Prickle?", url: "/prickles/p1", created_at: "2026-10-05T10:40:00Z", banner_until: null, read_at: null },
  { id: "n2", kind: "prickle_checkout", text: "Checking out of Sprint", url: "/prickles/p2", created_at: "2026-10-04T09:00:00Z", banner_until: null, read_at: "2026-10-04T10:00:00Z" },
];

async function renderPage(params: Record<string, string> = {}) {
  const ui = await NotificationsPage({ searchParams: Promise.resolve(params) });
  return render(<InAppNotificationsProvider initial={{ latest: [], unreadCount: 1 }}>{ui}</InAppNotificationsProvider>);
}

/** The row query (the one that selects columns rather than counting). */
const rowQuery = (fake: FakeSupabase) =>
  fake.queries.find((q) => q.table === "in_app_notifications" && q.calls.some((c) => c.method === "range"))!;

let fake: FakeSupabase;

beforeEach(() => {
  resetServerPageMocks();
  routerMock.push.mockClear();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  vi.mocked(getUserFeaturePreviews).mockResolvedValue(["in_app_notifications"]);
  fake = useFakeSupabase({ in_app_notifications: { data: ROWS, count: 2 } });
});

describe("/notifications", () => {
  it("is a 404 without the in_app_notifications flag", async () => {
    vi.mocked(getUserFeaturePreviews).mockResolvedValue([]);
    await expect(NotificationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow();
    expect(notFound).toHaveBeenCalled();
  });

  it("sends anyone signed out to log in", async () => {
    signInAs(null);
    await expectRedirect(NotificationsPage, { searchParams: Promise.resolve({}) }, "/login");
  });

  it("shows the sudo'd member's notifications like any other member page", async () => {
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await renderPage();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(/hidden while browsing as them/)).not.toBeInTheDocument();
    expect(rowQuery(fake).calls).toContainEqual({ method: "eq", args: ["member_id", MEMBER_IDENTITY.memberId] });
  });

  it("lists the member's notifications newest first, unread marked, with type and filter counts", async () => {
    await renderPage();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Ready for Progress Prickle?");
    expect(rows[0]).toHaveTextContent("Prickle check-ins");
    expect(within(rows[0]).getByLabelText("Unread")).toBeInTheDocument();
    expect(within(rows[1]).queryByLabelText("Unread")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All (2)" })).toHaveAttribute("aria-pressed", "true");

    const query = rowQuery(fake);
    expect(query.calls).toContainEqual({ method: "eq", args: ["member_id", MEMBER_IDENTITY.memberId] });
    expect(query.calls).toContainEqual({ method: "order", args: ["created_at", { ascending: false }] });
    expect(query.calls).toContainEqual({ method: "range", args: [0, 49] });
  });

  it("filters to unread and one type, sorts, and pages from the URL", async () => {
    await renderPage({ filter: "unread", kind: "prickle_checkout", sort: "kind", dir: "asc", page: "2", pageSize: "25" });
    const query = rowQuery(fake);
    expect(query.calls).toContainEqual({ method: "is", args: ["read_at", null] });
    expect(query.calls).toContainEqual({ method: "eq", args: ["kind", "prickle_checkout"] });
    expect(query.calls).toContainEqual({ method: "order", args: ["kind", { ascending: true }] });
    // Only 2 match, so page 2 is clamped back to page 1.
    expect(query.calls).toContainEqual({ method: "range", args: [0, 24] });
  });

  it("ignores unknown filters, types and sort columns", async () => {
    await renderPage({ filter: "spam", kind: "carrier_pigeon", sort: "text" });
    const query = rowQuery(fake);
    expect(query.calls.some((c) => c.method === "is")).toBe(false);
    expect(query.calls.some((c) => c.method === "eq" && c.args[0] === "kind")).toBe(false);
    expect(query.calls).toContainEqual({ method: "order", args: ["created_at", { ascending: false }] });
  });

  it("puts filter, type and sort changes in the URL, back to page 1", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole("button", { name: /^Unread/ }));
    expect(routerMock.push).toHaveBeenLastCalledWith("/?filter=unread");

    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "prickle_checkout");
    expect(routerMock.push).toHaveBeenLastCalledWith("/?kind=prickle_checkout");

    await user.click(screen.getByRole("columnheader", { name: /Type/ }));
    expect(routerMock.push).toHaveBeenLastCalledWith("/?sort=kind&dir=asc");
  });

  it("opening an unread one marks it read; Mark all as read marks the rest", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole("link", { name: "Ready for Progress Prickle?" }));
    const updates = () => fake.queries.filter((q) => q.calls.some((c) => c.method === "update"));
    await vi.waitFor(() => expect(updates()).toHaveLength(1));
    expect(updates()[0].calls).toContainEqual({ method: "in", args: ["id", ["n1"]] });
    expect(screen.getByRole("button", { name: "Unread (1)" })).toBeInTheDocument();

    routerMock.refresh.mockClear();
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    await vi.waitFor(() => expect(updates()).toHaveLength(2));
    expect(updates()[1].calls.some((c) => c.method === "in")).toBe(false);
    expect(screen.getByRole("button", { name: "Unread (0)" })).toBeInTheDocument();
    await vi.waitFor(() => expect(routerMock.refresh).toHaveBeenCalled());
  });
});
