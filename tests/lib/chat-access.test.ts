import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCurrentUser, getEffectiveIdentity, hasFeature, getSlackConnectionStatus, isSlackConnectConfigured } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEffectiveIdentity: vi.fn(),
  hasFeature: vi.fn(),
  getSlackConnectionStatus: vi.fn(),
  isSlackConnectConfigured: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: (...a: unknown[]) => hasFeature(...a),
}));
vi.mock("@/lib/slack-connect", () => ({
  getSlackConnectionStatus: (...a: unknown[]) => getSlackConnectionStatus(...a),
  isSlackConnectConfigured: () => isSlackConnectConfigured(),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

import { requireChat } from "@/lib/chat/access";

beforeEach(() => {
  getCurrentUser.mockResolvedValue({ id: "auth-1", email: "fern@example.test" });
  getEffectiveIdentity.mockResolvedValue({ memberId: "m1", isSudo: false });
  hasFeature.mockResolvedValue(true);
  isSlackConnectConfigured.mockReturnValue(true);
  getSlackConnectionStatus.mockReset();
  getSlackConnectionStatus.mockResolvedValue({ connected: true, sharesReadState: true, revoked: false });
});

describe("requireChat", () => {
  it("lets a member with a full Slack connection in", async () => {
    await expect(requireChat()).resolves.toMatchObject({ identity: { memberId: "m1" } });
    expect(getSlackConnectionStatus).toHaveBeenCalledWith(expect.anything(), "m1");
  });

  it("sends a member without a connection to settings to connect", async () => {
    getSlackConnectionStatus.mockResolvedValue({ connected: false, sharesReadState: false, revoked: false });
    await expect(requireChat()).rejects.toThrow("redirect:/settings?slack=required");
  });

  it("asks a connection that lacks the read scopes to reconnect", async () => {
    getSlackConnectionStatus.mockResolvedValue({ connected: true, sharesReadState: false, revoked: false });
    await expect(requireChat()).rejects.toThrow("redirect:/settings?slack=required");
  });

  it("doesn't check the connection in sudo, which is read-only", async () => {
    getEffectiveIdentity.mockResolvedValue({ memberId: "m1", isSudo: true });
    getSlackConnectionStatus.mockResolvedValue({ connected: false, sharesReadState: false, revoked: false });
    await expect(requireChat()).resolves.toBeDefined();
    expect(getSlackConnectionStatus).not.toHaveBeenCalled();
  });

  it("doesn't lock everyone out while the Slack app isn't configured", async () => {
    isSlackConnectConfigured.mockReturnValue(false);
    getSlackConnectionStatus.mockResolvedValue({ connected: false, sharesReadState: false, revoked: false });
    await expect(requireChat()).resolves.toBeDefined();
    expect(getSlackConnectionStatus).not.toHaveBeenCalled();
  });

  it("still sends visitors who are signed out to login, members without a record to admin, and hides chat without the feature", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    await expect(requireChat()).rejects.toThrow("redirect:/login");
    getEffectiveIdentity.mockResolvedValueOnce(null);
    await expect(requireChat()).rejects.toThrow("redirect:/admin");
    hasFeature.mockResolvedValueOnce(false);
    await expect(requireChat()).rejects.toThrow("notFound");
  });
});
