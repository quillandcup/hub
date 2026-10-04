// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
const { default: InAppNotificationBanner, IN_APP_POLL_MS } = await import("@/components/InAppNotificationBanner");

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const CHECKIN = { id: "n1", kind: "prickle_checkin", text: "Ready for Progress Prickle in ~20 min? Check in", url: "/prickles/p1", createdAt: "2026-10-05T10:40:00Z" };
const CHECKOUT = { id: "n2", kind: "prickle_checkout", text: "Checking out of Sprint: how did it go?", url: "/prickles/p2", createdAt: "2026-10-05T09:00:00Z" };

const updates = () => fake.queries.filter((q) => q.calls.some((c) => c.method === "update"));

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
  it("reads the member's own banners", async () => {
    fake = createFakeSupabase({
      in_app_notifications: { data: [{ id: "n1", kind: "prickle_checkin", text: "Hi", url: null, created_at: "2026-10-05T10:40:00Z" }] },
    });
    expect(await actions.getMyInAppNotifications()).toEqual([
      { id: "n1", kind: "prickle_checkin", text: "Hi", url: null, createdAt: "2026-10-05T10:40:00Z" },
    ]);
    expect(fake.queries[0].calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
  });

  it("shows nothing and dismisses nothing in sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    expect(await actions.getMyInAppNotifications()).toEqual([]);
    expect(await actions.dismissInAppNotification("n1")).toHaveProperty("error");
    expect(fake.queries).toHaveLength(0);
  });

  it("dismisses only the member's own", async () => {
    expect(await actions.dismissInAppNotification("n1")).toEqual({ success: true });
    const [update] = updates();
    expect(update.calls).toContainEqual({ method: "update", args: [{ dismissed_at: expect.any(String) }] });
    expect(update.calls).toContainEqual({ method: "eq", args: ["id", "n1"] });
    expect(update.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
  });
});

describe("InAppNotificationBanner", () => {
  it("renders nothing with no notifications", () => {
    const { container } = render(<InAppNotificationBanner initial={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each notification with a link to act on it", () => {
    render(<InAppNotificationBanner initial={[CHECKIN, CHECKOUT]} />);
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).toHaveTextContent(CHECKIN.text);
    expect(region).toHaveTextContent(CHECKOUT.text);
    expect(screen.getAllByRole("link", { name: "Open →" }).map((a) => a.getAttribute("href"))).toEqual([
      "/prickles/p1",
      "/prickles/p2",
    ]);
  });

  it("dismisses one", async () => {
    const user = userEvent.setup();
    render(<InAppNotificationBanner initial={[CHECKIN, CHECKOUT]} />);
    await user.click(screen.getByRole("button", { name: `Dismiss: ${CHECKIN.text}` }));
    expect(screen.queryByText(CHECKIN.text)).not.toBeInTheDocument();
    expect(screen.getByText(CHECKOUT.text)).toBeInTheDocument();
    await waitFor(() => expect(updates()).toHaveLength(1));
  });

  it("puts it back and says so when the dismiss fails", async () => {
    fake = createFakeSupabase({ in_app_notifications: { error: { message: "boom" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<InAppNotificationBanner initial={[CHECKIN]} />);
    await user.click(screen.getByRole("button", { name: `Dismiss: ${CHECKIN.text}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't dismiss");
    expect(screen.getByText(CHECKIN.text)).toBeInTheDocument();
  });

  it("picks up new notifications while the tab is visible", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    fake = createFakeSupabase({
      in_app_notifications: {
        data: [{ id: "n2", kind: "prickle_checkout", text: CHECKOUT.text, url: CHECKOUT.url, created_at: CHECKOUT.createdAt }],
      },
    });
    render(<InAppNotificationBanner initial={[]} />);
    expect(screen.queryByText(CHECKOUT.text)).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(IN_APP_POLL_MS);
    });
    expect(await screen.findByText(CHECKOUT.text)).toBeInTheDocument();
  });

  it("checks again when the tab comes back", async () => {
    fake = createFakeSupabase({
      in_app_notifications: {
        data: [{ id: "n1", kind: "prickle_checkin", text: CHECKIN.text, url: CHECKIN.url, created_at: CHECKIN.createdAt }],
      },
    });
    render(<InAppNotificationBanner initial={[]} />);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText(CHECKIN.text)).toBeInTheDocument();
  });
});
