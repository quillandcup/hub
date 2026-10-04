// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  renderServerRoute,
  resetServerPageMocks,
  signInAs,
} from "@/tests/helpers/server-page";

// Settings tabs live at /settings (Account) and /settings/<id> (lib/tab-routes.ts); legacy
// /settings?tab=<id> links redirect there. Panels that load their own data are stubbed.

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

const getHostedVibes = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("@/app/(member)/prickle-picker/actions", () => ({ getHostedVibes: () => getHostedVibes() }));
vi.mock("@/components/HostVibePanel", () => ({ default: () => <div>host vibe panel</div> }));
vi.mock("@/app/(member)/settings/SessionsPanel", () => ({ SessionsPanel: () => <div>sessions</div> }));
vi.mock("@/app/(member)/settings/ProfilePanel", () => ({ ProfilePanel: () => <div>profile panel</div> }));
vi.mock("@/app/(member)/settings/IdentityPanel", () => ({ IdentityPanel: () => <div>identity panel</div> }));
vi.mock("@/app/(member)/settings/NotificationsPanel", () => ({ NotificationsPanel: () => <div>notifications panel</div> }));

const NOTIFICATION_SETTINGS = { channelsByKind: { prickle_checkin: ["slack"], prickle_checkout: ["slack"] }, readOnly: false };
const getNotificationSettings = vi.fn(async (): Promise<unknown> => NOTIFICATION_SETTINGS);
vi.mock("@/app/(member)/settings/notificationActions", () => ({
  getNotificationSettings: () => getNotificationSettings(),
  setNotificationChannel: vi.fn(),
}));

const { default: SettingsIndex } = await import("@/app/(member)/settings/page");
const { default: NotificationsRoute } = await import("@/app/(member)/settings/notifications/page");
const { default: HostingRoute } = await import("@/app/(member)/settings/hosting/page");
const { default: SettingsPage } = await import("@/app/(member)/settings/SettingsPage");

const indexProps = (searchParams: Record<string, string> = {}) => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve(searchParams),
});
const selectedTab = () => screen.getByRole("tab", { selected: true }).textContent;

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  getHostedVibes.mockResolvedValue([]);
  getNotificationSettings.mockResolvedValue(NOTIFICATION_SETTINGS);
});

describe("settings routes", () => {
  it("/settings opens Account", async () => {
    await renderServerRoute(SettingsIndex, indexProps());
    expect(selectedTab()).toBe("Account");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Account",
      "Profile",
      "Identity",
      "Preferences",
      "Notifications",
    ]);
  });

  it("/settings/notifications opens Notifications", async () => {
    await renderServerRoute(NotificationsRoute, undefined as never);
    expect(selectedTab()).toBe("Notifications");
    expect(screen.getByText("notifications panel")).toBeInTheDocument();
  });

  it("shows Hosting to hosts at /settings/hosting", async () => {
    getHostedVibes.mockResolvedValue([{ typeId: "t1" }]);
    await renderServerRoute(HostingRoute, undefined as never);
    expect(selectedTab()).toBe("Hosting");
    expect(screen.getByText("host vibe panel")).toBeInTheDocument();
  });

  it("sends a non-host on /settings/hosting to /settings", async () => {
    await expectRedirect(SettingsPage, { tab: "hosting" }, "/settings");
  });

  it("sends someone with no member record on /settings/notifications to /settings", async () => {
    getNotificationSettings.mockResolvedValue(null);
    await expectRedirect(SettingsPage, { tab: "notifications" }, "/settings");
  });
});

describe("legacy /settings?tab= links", () => {
  it("redirect to the tab's path", async () => {
    await expectRedirect(SettingsIndex, indexProps({ tab: "notifications" }), "/settings/notifications");
  });

  it("send ?tab=account to /settings, and ignore an unknown tab", async () => {
    await expectRedirect(SettingsIndex, indexProps({ tab: "account" }), "/settings");
    await renderServerRoute(SettingsIndex, indexProps({ tab: "bogus" }));
    expect(selectedTab()).toBe("Account");
  });
});
