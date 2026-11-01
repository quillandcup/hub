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
} from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { InAppNotificationRow } from "@/lib/data/notifications";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

// The notifications come from the notification repository, in memory here.
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
const { default: NotificationsPage } = await import("@/app/(member)/notifications/page");
const { InAppNotificationsProvider } = await import("@/components/InAppNotifications");

const note = (id: string, over: Partial<InAppNotificationRow>): InAppNotificationRow => ({
  id,
  memberId: MEMBER_IDENTITY.memberId,
  kind: "prickle_checkin",
  ref: null,
  text: "",
  url: null,
  bannerUntil: null,
  readAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});
const ROWS = [
  note("n1", { kind: "prickle_checkin", text: "Ready for Progress Prickle?", url: "/prickles/p1", createdAt: "2026-10-05T10:40:00Z" }),
  note("n2", { kind: "prickle_checkout", text: "Checking out of Sprint", url: "/prickles/p2", createdAt: "2026-10-04T09:00:00Z", readAt: "2026-10-04T10:00:00Z" }),
];
// Someone else's notification must never show.
const NOT_MINE = note("n9", { memberId: "mbr_ZZZZZZZZZZZZ", text: "Not yours", createdAt: "2026-10-06T00:00:00Z" });

async function renderPage(params: Record<string, string> = {}) {
  const ui = await NotificationsPage({ searchParams: Promise.resolve(params) });
  return render(<InAppNotificationsProvider initial={{ latest: [], unreadCount: 1 }}>{ui}</InAppNotificationsProvider>);
}


beforeEach(() => {
  resetServerPageMocks();
  routerMock.push.mockClear();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  repos = createInMemoryRepos(new InMemoryDataset({ inAppNotifications: [...ROWS, NOT_MINE] }));
});

describe("/notifications", () => {

  it("sends anyone signed out to log in", async () => {
    signInAs(null);
    await expectRedirect(NotificationsPage, { searchParams: Promise.resolve({}) }, "/login");
  });

  it("shows the sudo'd member's notifications like any other member page", async () => {
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await renderPage();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(/hidden while browsing as them/)).not.toBeInTheDocument();
    expect(screen.getByText("Ready for Progress Prickle?")).toBeInTheDocument();
    expect(screen.queryByText("Not yours")).not.toBeInTheDocument();
  });

  it("lists the member's notifications newest first, unread marked, with type and filter counts", async () => {
    await renderPage();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Ready for Progress Prickle?");
    expect(rows[0]).toHaveTextContent("Prickle check-ins");
    expect(within(rows[0]).getByLabelText("Unread")).toBeInTheDocument();
    expect(within(rows[1]).queryByLabelText("Unread")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Not yours")).not.toBeInTheDocument();
  });

  it("filters to unread and one type, sorts, and pages from the URL", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        inAppNotifications: [
          note("k1", { kind: "prickle_checkout", text: "Checkout one", createdAt: "2026-10-05T10:00:00Z" }),
          note("k2", { kind: "prickle_checkout", text: "Checkout two", createdAt: "2026-10-05T11:00:00Z" }),
          note("k3", { kind: "prickle_checkout", text: "Checkout read", readAt: "2026-10-05T12:00:00Z" }),
          note("c1", { kind: "prickle_checkin", text: "A check-in" }),
        ],
      })
    );
    await renderPage({ filter: "unread", kind: "prickle_checkout", sort: "kind", dir: "asc", page: "2", pageSize: "25" });
    // Only the unread check-outs match, so page 2 is clamped back to page 1.
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Checkout two");
    expect(rows[1]).toHaveTextContent("Checkout one");
  });

  it("ignores unknown filters, types and sort columns", async () => {
    await renderPage({ filter: "spam", kind: "carrier_pigeon", sort: "text" });
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Ready for Progress Prickle?"), expect.stringContaining("Checking out of Sprint")]);
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
    repos = createInMemoryRepos(new InMemoryDataset({ inAppNotifications: [...ROWS, note("n3", { text: "Another unread", createdAt: "2026-10-03T00:00:00Z" }), NOT_MINE] }));
    const user = userEvent.setup();
    await renderPage();
    expect(screen.getByRole("button", { name: "Unread (2)" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Ready for Progress Prickle?" }));
    const readAt = async (id: string) => (await repos.notifications.inAppById(MEMBER_IDENTITY.memberId, id))?.readAt ?? null;
    await vi.waitFor(async () => expect(await readAt("n1")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Unread (1)" })).toBeInTheDocument();

    routerMock.refresh.mockClear();
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Unread (0)" })).toBeInTheDocument());
    // Mark all as read only touches the member's own.
    expect(await repos.notifications.inAppCount("mbr_ZZZZZZZZZZZZ", { unreadOnly: true })).toBe(1);
    await vi.waitFor(() => expect(routerMock.refresh).toHaveBeenCalled());
  });
});
