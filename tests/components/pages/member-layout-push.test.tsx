// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
const effectiveMemberHasFeature = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => ({ memberId: "m1", memberName: "Member", memberEmail: "m@example.test", isSudo: false }));
const syncBrowserPush = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browser-push", () => ({ syncBrowserPush }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: async () => identity }));
const previews = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: async () => previews.list, effectiveMemberHasFeature }));
const tour = vi.hoisted(() => ({ active: false }));
vi.mock("@/lib/onboarding.server", () => ({ getOnboardingState: async () => (tour.active ? { active: true, steps: [], currentStepId: null } : null) }));
const slack = vi.hoisted(() => ({ configured: true, status: { connected: true, sharesReadState: true, revoked: false } }));
vi.mock("@/lib/slack-connect", () => ({ isSlackConnectConfigured: () => slack.configured, getSlackConnectionStatus: async () => slack.status }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/components/SlackConnectPrompt", () => ({ default: ({ need }: { need: string }) => <p data-testid="slack-prompt"><span data-testid="bar">slack</span>{need}</p> }));
vi.mock("@/components/MemberNavigation", () => ({ default: () => null }));
vi.mock("@/components/MemberFooter", () => ({ default: () => <p data-testid="footer">footer</p> }));
vi.mock("@/components/UserMenu", () => ({ default: () => null }));
vi.mock("@/components/search/SearchPalette", () => ({ default: () => null }));
vi.mock("@/components/WithInAppNotifications", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/SudoBanner", () => ({ default: () => <p data-testid="bar">sudo</p> }));
vi.mock("@/components/InstallAppPrompt", () => ({ InstallAppPrompt: () => <p data-testid="bar">install</p> }));
vi.mock("@/components/TimezoneInitializer", () => ({ TimezoneInitializer: () => null }));
vi.mock("@/components/FeedbackWidget", () => ({ default: () => null }));
vi.mock("@/components/PageViewTracker", () => ({ default: () => null }));
vi.mock("@/components/onboarding/OnboardingGuide", () => ({ default: () => null }));
import MemberLayout from "@/app/(member)/layout";
beforeEach(() => {
  tour.active = false;
  slack.configured = true;
  slack.status = { connected: true, sharesReadState: true, revoked: false };
  previews.list = [];
  identity.isSudo = false;
  effectiveMemberHasFeature.mockReset().mockResolvedValue(false);
  syncBrowserPush.mockReset().mockResolvedValue(undefined);
});
it("cleans up stale browser subscriptions even when the current member has no notification preview", async () => {
  render(await MemberLayout({ children: <div>Member content</div> }));
  await waitFor(() => expect(syncBrowserPush).toHaveBeenCalledTimes(1));
});
it("preserves the admin's subscription when viewing another member in sudo", async () => {
  identity.isSudo = true;
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(syncBrowserPush).not.toHaveBeenCalled();
});

afterEach(() => vi.unstubAllEnvs());
it.each(["AAAA", ""])("passes available browser push keys for automatic resume (%s)", async (key) => {
  effectiveMemberHasFeature.mockImplementation(async (feature: string) => feature === "browser_notifications");
  if (key) vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", key);
  else vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", undefined);
  render(await MemberLayout({ children: <div>Member content</div> }));
  await waitFor(() => expect(syncBrowserPush).toHaveBeenCalledWith("m1", key || null, expect.any(AbortSignal)));
});

it("shows the footer under the page", async () => {
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.getByTestId("footer")).toBeInTheDocument();
});

it.each([
  ["connect", { connected: false, sharesReadState: false, revoked: false }],
  ["reconnect", { connected: false, sharesReadState: false, revoked: true }],
  ["update", { connected: true, sharesReadState: false, revoked: false }],
])("asks a member who has chat but not a working Slack connection to %s it", async (need, status) => {
  effectiveMemberHasFeature.mockImplementation(async (feature: string) => feature === "chat");
  slack.status = status;
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.getByTestId("slack-prompt")).toHaveTextContent(need);
});

it("doesn't ask when Slack is connected, chat is off, it is sudo, or Slack isn't configured", async () => {
  effectiveMemberHasFeature.mockImplementation(async (feature: string) => feature === "chat");
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.queryByTestId("slack-prompt")).not.toBeInTheDocument();
  cleanup();

  slack.status = { connected: false, sharesReadState: false, revoked: false };
  effectiveMemberHasFeature.mockResolvedValue(false);
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.queryByTestId("slack-prompt")).not.toBeInTheDocument();
  cleanup();

  effectiveMemberHasFeature.mockImplementation(async (feature: string) => feature === "chat");
  identity.isSudo = true;
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.queryByTestId("slack-prompt")).not.toBeInTheDocument();
  cleanup();

  identity.isSudo = false;
  slack.configured = false;
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.queryByTestId("slack-prompt")).not.toBeInTheDocument();
});

it("leaves the Slack bar out while the Getting started tour is running, which has the same step", async () => {
  effectiveMemberHasFeature.mockImplementation(async (feature: string) => feature === "chat");
  slack.status = { connected: false, sharesReadState: false, revoked: false };
  tour.active = true;
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.queryByTestId("slack-prompt")).not.toBeInTheDocument();
});

it("stacks the bars above the header by priority: sudo, then install, then Slack", async () => {
  effectiveMemberHasFeature.mockResolvedValue(true);
  slack.status = { connected: false, sharesReadState: false, revoked: false };
  identity.isSudo = true;
  // Sudo hides the Slack bar (the member's own connection), so check that pair first.
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.getAllByTestId("bar").map((el) => el.textContent)).toEqual(["sudo", "install"]);
  cleanup();

  identity.isSudo = false;
  render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.getAllByTestId("bar").map((el) => el.textContent)).toEqual(["install", "slack"]);
});
