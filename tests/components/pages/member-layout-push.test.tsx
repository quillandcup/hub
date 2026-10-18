// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createFakeSupabase } from "@/tests/helpers/server-page";
const effectiveMemberHasFeature = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => ({ memberId: "m1", memberName: "Member", memberEmail: "m@example.test", isSudo: false }));
const syncBrowserPush = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browser-push", () => ({ syncBrowserPush }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeSupabase() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: async () => identity }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: async () => [], effectiveMemberHasFeature }));
vi.mock("@/lib/onboarding.server", () => ({ getOnboardingState: async () => null }));
vi.mock("@/components/MemberNavigation", () => ({ default: () => null }));
vi.mock("@/components/UserMenu", () => ({ default: () => null }));
vi.mock("@/components/search/SearchPalette", () => ({ default: () => null }));
vi.mock("@/components/SudoBanner", () => ({ default: () => null }));
vi.mock("@/components/InstallAppPrompt", () => ({ InstallAppPrompt: () => null }));
vi.mock("@/components/TimezoneInitializer", () => ({ TimezoneInitializer: () => null }));
vi.mock("@/components/FeedbackWidget", () => ({ default: () => null }));
vi.mock("@/components/PageViewTracker", () => ({ default: () => null }));
vi.mock("@/components/onboarding/OnboardingGuide", () => ({ default: () => null }));
import MemberLayout from "@/app/(member)/layout";
beforeEach(() => {
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
