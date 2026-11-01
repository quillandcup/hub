// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { InAppNotificationRow } from "@/lib/data/notifications";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { InAppNotificationBanner, InAppNotificationBell } from "@/components/InAppNotifications";
import WithInAppNotifications from "@/components/WithInAppNotifications";

// The notifications come from the notification repository, in memory here.
let repos: Repos;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
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
const note = (id: string, memberId: string): InAppNotificationRow => ({
  id,
  memberId,
  kind: "prickle_checkin",
  ref: null,
  text: "Hi",
  url: null,
  bannerUntil: null,
  readAt: null,
  createdAt: "2026-10-05T10:40:00Z",
});

describe("WithInAppNotifications", () => {
  it("gives the bell the effective member's unread count", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({ inAppNotifications: [note("n1", "member-1"), note("n2", "member-1"), note("n3", "member-1"), note("theirs", "member-2")] })
    );
    render(await WithInAppNotifications({ identity: IDENTITY, children: header }));

    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
  });

  it("shows no bell for an admin with no member record, and still renders the page", async () => {
    repos = createInMemoryRepos();
    const unread = vi.spyOn(repos.notifications, "inAppCount");
    render(await WithInAppNotifications({ identity: null, children: <>{header}<p>the page</p></> }));

    expect(screen.queryByRole("button", { name: /Notifications/ })).not.toBeInTheDocument();
    expect(screen.getByText("the page")).toBeInTheDocument();
    expect(unread).not.toHaveBeenCalled();
  });
});
