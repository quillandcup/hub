// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
let serviceFake: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => serviceFake }));

const { getCurrentUser } = await import("@/lib/auth");
const { getEffectiveIdentity } = await import("@/lib/sudo");
const actions = await import("@/app/actions/in-app-notifications");
const { InAppNotificationsProvider, InAppNotificationBanner, InAppNotificationBell, IN_APP_POLL_MS, INBOX_PATH } =
  await import("@/components/InAppNotifications");
import type { InAppNotification } from "@/lib/channels/in-app";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({ track }));

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
// A time-sensitive check-in (banner), an older check-out only in the bell, and a read one.
const CHECKIN: InAppNotification = {
  id: "n1",
  kind: "prickle_checkin",
  text: "Ready for Progress Prickle in ~20 min? Check in",
  url: "/prickles/p1",
  createdAt: "2026-10-05T10:40:00Z",
  read: false,
  banner: true,
};
const CHECKOUT: InAppNotification = {
  id: "n2",
  kind: "prickle_checkout",
  text: "Checking out of Sprint: how did it go?",
  url: "/prickles/p2",
  createdAt: "2026-10-04T09:00:00Z",
  read: false,
  banner: false,
};
const OLD: InAppNotification = { ...CHECKOUT, id: "n3", text: "An old one", read: true };

const updates = () => fake.queries.filter((q) => q.calls.some((c) => c.method === "update"));

function renderInApp(latest: InAppNotification[], unreadCount = latest.filter((n) => !n.read).length) {
  return render(
    <InAppNotificationsProvider initial={{ latest, unreadCount }}>
      <InAppNotificationBell />
      <InAppNotificationBanner />
    </InAppNotificationsProvider>
  );
}

beforeEach(() => {
  track.mockClear();
  fake = createFakeSupabase();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("in-app notification actions", () => {
  it("reads the member's latest and their unread count", async () => {
    fake = createFakeSupabase({
      in_app_notifications: {
        data: [{ id: "n1", kind: "prickle_checkin", text: "Hi", url: null, created_at: "2026-10-05T10:40:00Z", banner_until: null, read_at: null }],
        count: 7,
      },
    });
    expect(await actions.getMyBellState()).toEqual({
      latest: [{ id: "n1", kind: "prickle_checkin", text: "Hi", url: null, createdAt: "2026-10-05T10:40:00Z", read: false, banner: false }],
      unreadCount: 7,
    });
    for (const q of fake.queries) expect(q.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
  });

  it("works as the sudo'd member: reads with the admin's session, marks read with the service role", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    serviceFake = createFakeSupabase({ in_app_notifications: { data: [] } });
    await actions.getMyBellState();
    for (const q of fake.queries) expect(q.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });

    expect(await actions.markInAppNotificationsReadAction(["n1"])).toEqual({ success: true });
    expect(await actions.markAllInAppNotificationsReadAction()).toEqual({ success: true });
    expect(serviceFake.queries).toHaveLength(2);
    for (const q of serviceFake.queries) {
      expect(q.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
    }
    expect(updates()).toHaveLength(0);
  });

  it("marks only the member's own read", async () => {
    expect(await actions.markInAppNotificationsReadAction(["n1", "n2"])).toEqual({ success: true });
    const [update] = updates();
    expect(update.calls).toContainEqual({ method: "update", args: [{ read_at: expect.any(String) }] });
    expect(update.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
    expect(update.calls).toContainEqual({ method: "in", args: ["id", ["n1", "n2"]] });
  });

  it("marks all of the member's own read", async () => {
    expect(await actions.markAllInAppNotificationsReadAction()).toEqual({ success: true });
    const [update] = updates();
    expect(update.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
    expect(update.calls).toContainEqual({ method: "is", args: ["read_at", null] });
    expect(update.calls.some((c) => c.method === "in")).toBe(false);
  });

  it("marks only the member's own unread", async () => {
    expect(await actions.markInAppNotificationsUnreadAction(["n1", "n2"])).toEqual({ success: true });
    const [update] = updates();
    expect(update.calls).toContainEqual({ method: "update", args: [{ read_at: null }] });
    expect(update.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
    expect(update.calls).toContainEqual({ method: "in", args: ["id", ["n1", "n2"]] });
  });

  it("rejects a bad id list", async () => {
    expect(await actions.markInAppNotificationsUnreadAction([])).toHaveProperty("error");
    expect(await actions.markInAppNotificationsReadAction([])).toHaveProperty("error");
    expect(await actions.markInAppNotificationsReadAction([""])).toHaveProperty("error");
    expect(fake.queries).toHaveLength(0);
  });
});

describe("InAppNotificationBanner", () => {
  it("shows only the time-sensitive ones, with a link to act", () => {
    renderInApp([CHECKIN, CHECKOUT]);
    const region = screen.getByRole("region", { name: "Time-sensitive notifications" });
    expect(region).toHaveTextContent(CHECKIN.text);
    expect(region).not.toHaveTextContent(CHECKOUT.text);
    expect(within(region).getByRole("link", { name: /^Open\s→$/ })).toHaveAttribute("href", "/prickles/p1");
  });

  it("on small screens links the rest to the inbox from a +N more pill in the first banner", () => {
    const second = { ...CHECKIN, id: "n4", text: "Second banner" };
    const third = { ...CHECKIN, id: "n5", text: "Third banner" };
    renderInApp([CHECKIN, second, third]);
    const region = screen.getByRole("region", { name: "Time-sensitive notifications" });
    const pill = within(region).getByRole("link", { name: "2 more notifications" });
    expect(pill).toHaveTextContent("+2 more");
    expect(pill).toHaveAttribute("href", INBOX_PATH);
    expect(pill).toHaveClass("sm:hidden");
    expect(within(region).getAllByRole("button", { name: /^Dismiss:/ })).toHaveLength(3);
  });

  it("on larger screens shows a +N more pill in the last banner for those past the cap", () => {
    const extra = [2, 3, 4, 5].map((n) => ({ ...CHECKIN, id: `x${n}`, text: `Banner ${n}` }));
    renderInApp([CHECKIN, ...extra]);
    const region = screen.getByRole("region", { name: "Time-sensitive notifications" });
    expect(within(region).getAllByRole("button", { name: /^Dismiss:/ })).toHaveLength(3);
    const pills = within(region).getAllByRole("link", { name: /more notifications/ });
    expect(pills).toHaveLength(2);
    const desktop = pills.find((p) => p.classList.contains("sm:inline"))!;
    expect(desktop).toHaveTextContent("+2 more");
    expect(desktop).toHaveAttribute("href", INBOX_PATH);
    expect(desktop.closest("div")).toHaveTextContent("Banner 3");
    expect(pills.find((p) => p.classList.contains("sm:hidden"))).toHaveTextContent("+4 more");
  });

  it("has no +N more pill with a single banner", () => {
    renderInApp([CHECKIN]);
    expect(screen.queryByRole("link", { name: /more notifications/ })).not.toBeInTheDocument();
  });

  it("renders nothing when nothing is time-sensitive", () => {
    renderInApp([CHECKOUT]);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("dismissing marks it read, so the bell stops counting it", async () => {
    const user = userEvent.setup();
    renderInApp([CHECKIN, CHECKOUT]);
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Dismiss: ${CHECKIN.text}` }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    await waitFor(() => expect(updates()).toHaveLength(1));
    expect(updates()[0].calls).toContainEqual({ method: "in", args: ["id", ["n1"]] });
  });

  it("puts it back and says so when that fails", async () => {
    fake = createFakeSupabase({ in_app_notifications: { error: { message: "boom" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderInApp([CHECKIN]);
    await user.click(screen.getByRole("button", { name: `Dismiss: ${CHECKIN.text}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't update");
    expect(screen.getByRole("region")).toHaveTextContent(CHECKIN.text);
  });
});

describe("InAppNotificationBell", () => {
  it("counts every unread one, not just those listed", () => {
    renderInApp([CHECKIN], 12);
    expect(screen.getByRole("button", { name: "Notifications, 12 unread" })).toHaveTextContent("9+");
  });

  it("lists the latest without marking them read, and links to the inbox", async () => {
    const user = userEvent.setup();
    renderInApp([CHECKIN, CHECKOUT, OLD]);
    await user.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));

    const items = within(screen.getByRole("list")).getAllByRole("link");
    expect(items.map((a) => a.textContent)).toEqual([
      expect.stringContaining(CHECKIN.text),
      expect.stringContaining(CHECKOUT.text),
      expect.stringContaining(OLD.text),
    ]);
    expect(items[0]).toHaveTextContent("(unread)");
    expect(items[2]).not.toHaveTextContent("(unread)");
    expect(screen.getByRole("link", { name: "See all notifications →" })).toHaveAttribute("href", INBOX_PATH);
    expect(updates()).toEqual([]);
  });

  it("opening one marks it read", async () => {
    const user = userEvent.setup();
    renderInApp([CHECKIN, CHECKOUT]);
    await user.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    await user.click(screen.getByRole("link", { name: new RegExp(CHECKOUT.text.replace("?", "\\?")) }));
    await waitFor(() => expect(updates()).toHaveLength(1));
    expect(updates()[0].calls).toContainEqual({ method: "in", args: ["id", ["n2"]] });
  });

  it("marks all as read", async () => {
    const user = userEvent.setup();
    renderInApp([CHECKIN, CHECKOUT]);
    await user.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    await waitFor(() => expect(updates()).toHaveLength(1));
    expect(updates()[0].calls.some((c) => c.method === "in")).toBe(false);
  });

  it("has nothing to mark when everything's read", async () => {
    const user = userEvent.setup();
    renderInApp([OLD]);
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  });

  it("says when there's nothing", async () => {
    const user = userEvent.setup();
    renderInApp([]);
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderInApp([OLD]);
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByText(OLD.text)).not.toBeInTheDocument();
  });
});

describe("InAppNotificationsProvider polling", () => {
  const row = { id: "n2", kind: "prickle_checkout", text: CHECKOUT.text, url: CHECKOUT.url, created_at: CHECKOUT.createdAt, banner_until: null, read_at: null };

  it("picks up new notifications while the tab is visible", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    fake = createFakeSupabase({ in_app_notifications: { data: [row], count: 1 } });
    renderInApp([]);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(IN_APP_POLL_MS);
    });
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
  });

  it("checks again when the tab comes back", async () => {
    fake = createFakeSupabase({ in_app_notifications: { data: [row], count: 1 } });
    renderInApp([]);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
  });
});

describe("notification_opened (usage analytics)", () => {
  it("is recorded, by kind, when a notification is opened from the bell", async () => {
    const user = userEvent.setup();
    renderInApp([CHECKIN, CHECKOUT]);
    await user.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    expect(track).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: new RegExp(CHECKOUT.text.replace("?", "\\?")) }));
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("notification_opened", { kind: "prickle_checkout", channel: "in_app" });
  });

  it("is recorded when the link in a time-sensitive banner is followed, but not when it is only dismissed", async () => {
    const user = userEvent.setup();
    renderInApp([CHECKIN]);
    await user.click(screen.getByRole("button", { name: /^Dismiss/ }));
    expect(track).not.toHaveBeenCalled();
  });

  it("is recorded for the banner's own link", async () => {
    const user = userEvent.setup();
    renderInApp([CHECKIN]);
    const link = within(screen.getByRole("region", { name: "Time-sensitive notifications" })).getByRole("link");
    link.addEventListener("click", (e) => e.preventDefault());
    await user.click(link);
    expect(track).toHaveBeenCalledWith("notification_opened", { kind: "prickle_checkin", channel: "in_app" });
  });
});
