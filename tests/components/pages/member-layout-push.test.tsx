// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render as plainRender, screen, waitFor } from "@testing-library/react";
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
const slack = vi.hoisted(() => ({ configured: true, status: { connected: true, sharesReadState: true, hasDmScopes: true, hasDmReactionScope: true, revoked: false } }));
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
// The layout hands its lookups to Suspense-wrapped pieces, so render inside an awaited act.
const render = (ui: React.ReactElement) => act(async () => { plainRender(ui); });
import MemberLayout from "@/app/(member)/layout";
beforeEach(() => {
  tour.active = false;
  slack.configured = true;
  slack.status = { connected: true, sharesReadState: true, hasDmScopes: true, hasDmReactionScope: true, revoked: false };
  previews.list = [];
  identity.isSudo = false;
  effectiveMemberHasFeature.mockReset().mockResolvedValue(false);
  syncBrowserPush.mockReset().mockResolvedValue(undefined);
});
it("cleans up stale browser subscriptions even when the current member has no notification preview", async () => {
  await render(await MemberLayout({ children: <div>Member content</div> }));
  await waitFor(() => expect(syncBrowserPush).toHaveBeenCalledTimes(1));
});
it("preserves the admin's subscription when viewing another member in sudo", async () => {
  identity.isSudo = true;
  await render(await MemberLayout({ children: <div>Member content</div> }));
  await screen.findByText("Member content");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(syncBrowserPush).not.toHaveBeenCalled();
});

afterEach(() => vi.unstubAllEnvs());
// The bars and the push guard load beside the page; give them a moment before asserting one is absent.
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));
it.each(["AAAA", ""])("passes available browser push keys for automatic resume (%s)", async (key) => {
  effectiveMemberHasFeature.mockImplementation(async (feature: string) => feature === "browser_notifications");
  if (key) vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", key);
  else vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", undefined);
  await render(await MemberLayout({ children: <div>Member content</div> }));
  await waitFor(() => expect(syncBrowserPush).toHaveBeenCalledWith("m1", key || null, expect.any(AbortSignal)));
});

it("makes the shell the positioned ancestor, so an sr-only element can't stretch the page past the window", async () => {
  await render(await MemberLayout({ children: <div>Member content</div> }));
  const shell = screen.getByText("Member content").closest("div.h-dvh");
  expect(shell).toHaveClass("relative", "overflow-hidden");
});

it("shows the footer under the page", async () => {
  await render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.getByTestId("footer")).toBeInTheDocument();
});

it.each([
  ["connect", { connected: false, sharesReadState: false, hasDmScopes: false, hasDmReactionScope: false, revoked: false }],
  ["reconnect", { connected: false, sharesReadState: false, hasDmScopes: false, hasDmReactionScope: false, revoked: true }],
  ["update", { connected: true, sharesReadState: false, hasDmScopes: false, hasDmReactionScope: false, revoked: false }],
  ["permissions", { connected: true, sharesReadState: true, hasDmScopes: false, hasDmReactionScope: false, revoked: false }],
  ["reactions", { connected: true, sharesReadState: true, hasDmScopes: true, hasDmReactionScope: false, revoked: false }],
])("asks a member without a working Slack connection to %s it", async (need, status) => {
  effectiveMemberHasFeature.mockResolvedValue(false);
  slack.status = status;
  await render(await MemberLayout({ children: <div>Member content</div> }));
  expect(await screen.findByTestId("slack-prompt")).toHaveTextContent(need);
});

it("doesn't ask when Slack is connected, it is sudo, or Slack isn't configured", async () => {
  effectiveMemberHasFeature.mockResolvedValue(false);
  await render(await MemberLayout({ children: <div>Member content</div> }));
  await settled();
  expect(screen.queryByTestId("slack-prompt")).not.toBeInTheDocument();
  cleanup();

  slack.status = { connected: false, sharesReadState: false, hasDmScopes: false, hasDmReactionScope: false, revoked: false };
  identity.isSudo = true;
  await render(await MemberLayout({ children: <div>Member content</div> }));
  await settled();
  expect(screen.queryByTestId("slack-prompt")).not.toBeInTheDocument();
  cleanup();

  identity.isSudo = false;
  slack.configured = false;
  await render(await MemberLayout({ children: <div>Member content</div> }));
  await settled();
  expect(screen.queryByTestId("slack-prompt")).not.toBeInTheDocument();
});

it("leaves the Slack bar out while the Getting started tour is running, which has the same step", async () => {
  effectiveMemberHasFeature.mockResolvedValue(false);
  slack.status = { connected: false, sharesReadState: false, hasDmScopes: false, hasDmReactionScope: false, revoked: false };
  tour.active = true;
  await render(await MemberLayout({ children: <div>Member content</div> }));
  await settled();
  expect(screen.queryByTestId("slack-prompt")).not.toBeInTheDocument();
});

it("stacks the bars above the header by priority: sudo, then install, then Slack", async () => {
  effectiveMemberHasFeature.mockResolvedValue(true);
  slack.status = { connected: false, sharesReadState: false, hasDmScopes: false, hasDmReactionScope: false, revoked: false };
  identity.isSudo = true;
  // Sudo hides the Slack bar (the member's own connection), so check that pair first.
  await render(await MemberLayout({ children: <div>Member content</div> }));
  await waitFor(() => expect(screen.getAllByTestId("bar").map((el) => el.textContent)).toEqual(["sudo", "install"]));
  cleanup();

  identity.isSudo = false;
  await render(await MemberLayout({ children: <div>Member content</div> }));
  await waitFor(() => expect(screen.getAllByTestId("bar").map((el) => el.textContent)).toEqual(["install", "slack"]));
});

it("doesn't hold the page back for the bars and the tour: it shows while their lookups are still running", async () => {
  const waiting: Array<() => void> = [];
  effectiveMemberHasFeature.mockImplementation(() => new Promise<boolean>((resolve) => { waiting.push(() => resolve(true)); }));
  await render(await MemberLayout({ children: <div>Member content</div> }));
  expect(screen.getByText("Member content")).toBeInTheDocument();
  expect(screen.queryByTestId("bar")).not.toBeInTheDocument();
  await act(async () => waiting.forEach((release) => release()));
  await waitFor(() => expect(screen.getAllByTestId("bar").map((el) => el.textContent)).toContain("install"));
});
