// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";
import { InAppNotificationBanner, InAppNotificationBell } from "@/components/InAppNotifications";
import WithInAppNotifications from "@/components/WithInAppNotifications";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
vi.mock("@/app/actions/in-app-notifications", () => ({
  getMyBellState: vi.fn(async () => ({ latest: [], unreadCount: 0 })),
  markInAppNotificationsReadAction: vi.fn(),
  markInAppNotificationsUnreadAction: vi.fn(),
  markAllInAppNotificationsReadAction: vi.fn(),
}));

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const header = (
  <>
    <InAppNotificationBell />
    <InAppNotificationBanner />
  </>
);

describe("WithInAppNotifications", () => {
  it("gives the bell the effective member's unread count", async () => {
    fake = createFakeSupabase({
      in_app_notifications: {
        data: [{ id: "n1", kind: "prickle_checkin", text: "Hi", url: null, created_at: "2026-10-05T10:40:00Z", banner_until: null, read_at: null }],
        count: 3,
      },
    });
    render(await WithInAppNotifications({ identity: IDENTITY, children: header }));

    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
    for (const q of fake.queries) expect(q.calls).toContainEqual({ method: "eq", args: ["member_id", "member-1"] });
  });

  it("shows no bell for an admin with no member record, and still renders the page", async () => {
    fake = createFakeSupabase();
    render(await WithInAppNotifications({ identity: null, children: <>{header}<p>the page</p></> }));

    expect(screen.queryByRole("button", { name: /Notifications/ })).not.toBeInTheDocument();
    expect(screen.getByText("the page")).toBeInTheDocument();
    expect(fake.queries).toHaveLength(0);
  });
});
