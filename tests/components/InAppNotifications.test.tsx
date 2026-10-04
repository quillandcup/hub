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

const { getCurrentUser } = await import("@/lib/auth");
const { getEffectiveIdentity } = await import("@/lib/sudo");
const actions = await import("@/app/actions/in-app-notifications");
const { InAppNotificationsProvider, InAppNotificationBanner, InAppNotificationBell, IN_APP_POLL_MS } = await import(
  "@/components/InAppNotifications"
);
import type { InAppNotification } from "@/lib/channels/in-app";

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
// A time-sensitive check-in (banner), and an older check-out that's only in the bell.
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

const readUpdates = () =>
  fake.queries.filter((q) => q.calls.some((c) => c.method === "update")).map((q) => q.calls.find((c) => c.method === "in")!.args[1]);

function renderInApp(initial: InAppNotification[]) {
  return render(
    <InAppNotificationsProvider initial={initial}>
      <InAppNotificationBell />
      <InAppNotificationBanner />
    </InAppNotificationsProvider>
  );
}

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("in-app notification actions", () => {
  it("reads the member's own list", async () => {
    fake = createFakeSupabase({
      in_app_notifications: {
        data: [{ id: "n1", kind: "prickle_checkin", text: "Hi", url: null, created_at: "2026-10-05T10:40:00Z", banner_until: null, read_at: null }],
      },
    });
    expect(await actions.getMyInAppNotifications()).toEqual([
      { id: "n1", kind: "prickle_checkin", text: "Hi", url: null, createdAt: "2026-10-05T10:40:00Z", read: false, banner: false },
    ]);
    expect(fake.queries[0].calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
  });

  it("shows nothing and changes nothing in sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect(await actions.getMyInAppNotifications()).toEqual([]);
    expect(await actions.markInAppNotificationsReadAction(["n1"])).toHaveProperty("error");
    expect(fake.queries).toHaveLength(0);
  });

  it("marks only the member's own read", async () => {
    expect(await actions.markInAppNotificationsReadAction(["n1", "n2"])).toEqual({ success: true });
    const update = fake.queries.find((q) => q.calls.some((c) => c.method === "update"))!;
    expect(update.calls).toContainEqual({ method: "update", args: [{ read_at: expect.any(String) }] });
    expect(update.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
    expect(update.calls).toContainEqual({ method: "in", args: ["id", ["n1", "n2"]] });
  });

  it("rejects a bad id list", async () => {
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
    expect(within(region).getByRole("link", { name: "Open →" })).toHaveAttribute("href", "/prickles/p1");
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
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
    await waitFor(() => expect(readUpdates()).toEqual([["n1"]]));
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
  it("counts the unread, and opening it lists everything and marks the unread read", async () => {
    const user = userEvent.setup();
    renderInApp([CHECKIN, CHECKOUT, OLD]);
    await user.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));

    const links = screen.getAllByRole("link").filter((a) => a.closest("ul"));
    expect(links.map((a) => a.textContent)).toEqual([
      expect.stringContaining(CHECKIN.text),
      expect.stringContaining(CHECKOUT.text),
      expect.stringContaining(OLD.text),
    ]);
    expect(screen.getByRole("button", { name: "Notifications" })).toHaveAttribute("aria-expanded", "true");
    // Read now, so the check-in's banner goes too.
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    await waitFor(() => expect(readUpdates()).toEqual([["n1", "n2"]]));
  });

  it("says when there's nothing", async () => {
    const user = userEvent.setup();
    renderInApp([]);
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
    expect(readUpdates()).toEqual([]);
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
    fake = createFakeSupabase({ in_app_notifications: { data: [row] } });
    renderInApp([]);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(IN_APP_POLL_MS);
    });
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
  });

  it("checks again when the tab comes back", async () => {
    fake = createFakeSupabase({ in_app_notifications: { data: [row] } });
    renderInApp([]);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
  });
});
