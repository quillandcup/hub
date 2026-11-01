// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { InAppNotificationRow } from "@/lib/data/notifications";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

// The member's own session and the service role (used for an admin in sudo) are told apart by the
// client the actions pass to createRepos; each has its own in-memory repositories.
const SESSION = { role: "session" };
const SERVICE = { role: "service" };
let session: Repos;
let service: Repos;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => SESSION }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => SERVICE }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: (db: unknown) => (db === SERVICE ? service : session),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));

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
  text: "Checking out of Sprint: did you get what you came for?",
  url: "/prickles/p2",
  createdAt: "2026-10-04T09:00:00Z",
  read: false,
  banner: false,
};
const OLD: InAppNotification = { ...CHECKOUT, id: "n3", text: "An old one", read: true };

const ME = "member-1";
const stored = (id: string, over: Partial<InAppNotificationRow> = {}): InAppNotificationRow => ({
  id,
  memberId: ME,
  kind: "prickle_checkin",
  ref: null,
  text: "Hi",
  url: null,
  bannerUntil: null,
  readAt: null,
  createdAt: "2026-10-05T10:40:00Z",
  ...over,
});
const world = (rows: InAppNotificationRow[]) => createInMemoryRepos(new InMemoryDataset({ inAppNotifications: rows }));
/** Which of these notifications are read, by id. */
const readIds = async (repos: Repos, ...ids: string[]) =>
  (await Promise.all(ids.map(async (id) => [id, (await repos.notifications.inAppById(ME, id))?.readAt != null] as const))).filter(([, read]) => read).map(([id]) => id);

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
  session = world([]);
  service = world([]);
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("in-app notification actions", () => {
  it("reads the member's latest and their unread count, and nobody else's", async () => {
    session = world([
      stored("n1"),
      stored("n2", { readAt: "2026-10-05T10:41:00Z", createdAt: "2026-10-05T10:30:00Z" }),
      stored("theirs", { memberId: "member-2" }),
    ]);
    expect(await actions.getMyBellState()).toEqual({
      latest: [
        { id: "n1", kind: "prickle_checkin", text: "Hi", url: null, createdAt: "2026-10-05T10:40:00Z", read: false, banner: false },
        { id: "n2", kind: "prickle_checkin", text: "Hi", url: null, createdAt: "2026-10-05T10:30:00Z", read: true, banner: false },
      ],
      unreadCount: 1,
    });
  });

  it("works as the sudo'd member: reads with the admin's session, marks read with the service role", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    session = world([stored("n1")]);
    service = world([stored("n1"), stored("n2")]);
    expect((await actions.getMyBellState()).unreadCount).toBe(1);

    expect(await actions.markInAppNotificationsReadAction(["n1"])).toEqual({ success: true });
    expect(await readIds(service, "n1", "n2")).toEqual(["n1"]);
    expect(await actions.markAllInAppNotificationsReadAction()).toEqual({ success: true });
    expect(await readIds(service, "n1", "n2")).toEqual(["n1", "n2"]);
    // The admin's own session is never used to write.
    expect(await readIds(session, "n1")).toEqual([]);
  });

  it("marks only the member's own read", async () => {
    session = world([stored("n1"), stored("n2"), stored("n3"), stored("theirs", { memberId: "member-2" })]);
    expect(await actions.markInAppNotificationsReadAction(["n1", "n2", "theirs"])).toEqual({ success: true });
    expect(await readIds(session, "n1", "n2", "n3")).toEqual(["n1", "n2"]);
    expect(await session.notifications.inAppCount("member-2", { unreadOnly: true })).toBe(1);
  });

  it("marks all of the member's own read", async () => {
    session = world([stored("n1"), stored("n2"), stored("theirs", { memberId: "member-2" })]);
    expect(await actions.markAllInAppNotificationsReadAction()).toEqual({ success: true });
    expect(await readIds(session, "n1", "n2")).toEqual(["n1", "n2"]);
    expect(await session.notifications.inAppCount("member-2", { unreadOnly: true })).toBe(1);
  });

  it("marks only the member's own unread", async () => {
    const readAt = "2026-10-05T10:41:00Z";
    session = world([stored("n1", { readAt }), stored("n2", { readAt }), stored("n3", { readAt }), stored("theirs", { memberId: "member-2", readAt })]);
    expect(await actions.markInAppNotificationsUnreadAction(["n1", "n2", "theirs"])).toEqual({ success: true });
    expect(await readIds(session, "n1", "n2", "n3")).toEqual(["n3"]);
    expect(await session.notifications.inAppCount("member-2", { unreadOnly: true })).toBe(0);
  });

  it("rejects a bad id list", async () => {
    session = world([stored("n1")]);
    expect(await actions.markInAppNotificationsUnreadAction([])).toHaveProperty("error");
    expect(await actions.markInAppNotificationsReadAction([])).toHaveProperty("error");
    expect(await actions.markInAppNotificationsReadAction([""])).toHaveProperty("error");
    expect(await readIds(session, "n1")).toEqual([]);
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
    session = world([stored("n1"), stored("n2")]);
    renderInApp([CHECKIN, CHECKOUT]);
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Dismiss: ${CHECKIN.text}` }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    await waitFor(async () => expect(await readIds(session, "n1", "n2")).toEqual(["n1"]));
  });

  it("puts it back and says so when that fails", async () => {
    session.notifications.markInAppRead = async () => {
      throw new Error("boom");
    };
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
    session = world([stored("n1"), stored("n2"), stored("n3", { readAt: "2026-10-05T10:41:00Z" })]);
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
    expect(await readIds(session, "n1", "n2")).toEqual([]);
  });

  it("opening one marks it read", async () => {
    session = world([stored("n1"), stored("n2")]);
    const user = userEvent.setup();
    renderInApp([CHECKIN, CHECKOUT]);
    await user.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    await user.click(screen.getByRole("link", { name: new RegExp(CHECKOUT.text.replace("?", "\\?")) }));
    await waitFor(async () => expect(await readIds(session, "n1", "n2")).toEqual(["n2"]));
  });

  it("marks all as read", async () => {
    session = world([stored("n1"), stored("n2")]);
    const user = userEvent.setup();
    renderInApp([CHECKIN, CHECKOUT]);
    await user.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    await waitFor(async () => expect(await readIds(session, "n1", "n2")).toEqual(["n1", "n2"]));
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
  const row = stored("n2", { kind: "prickle_checkout", text: CHECKOUT.text, url: CHECKOUT.url, createdAt: CHECKOUT.createdAt });

  it("picks up new notifications while the tab is visible", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    session = world([row]);
    renderInApp([]);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(IN_APP_POLL_MS);
    });
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
  });

  it("checks again when the tab comes back", async () => {
    session = world([row]);
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
