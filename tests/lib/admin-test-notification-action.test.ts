import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  identity: vi.fn(),
  send: vi.fn(),
  service: vi.fn(() => ({ service: true })),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: mocks.auth }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: mocks.identity }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/notification-test", () => ({ sendTestNotification: mocks.send }));

import { sendTestNotification } from "@/app/(admin)/admin/notifications/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: "admin-user" } });
  mocks.identity.mockResolvedValue({ memberId: "m-admin", isSudo: false });
  mocks.send.mockResolvedValue({ ok: true, sent: 1 });
});

describe("sendTestNotification action", () => {
  it("sends to the admin's own member record", async () => {
    expect(await sendTestNotification("intro_nudge", "slack")).toEqual({ success: true, sent: 1 });
    expect(mocks.send).toHaveBeenCalledWith({ service: true }, "m-admin", "intro_nudge", "slack");
  });

  it("refuses a non-admin before doing anything", async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: "Forbidden" });

    expect(await sendTestNotification("intro_nudge", "slack")).toEqual({ error: "Forbidden" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ["nope", "slack", "Unknown notification"],
    ["intro_nudge", "carrier_pigeon", "Unknown channel"],
  ])("rejects %s on %s", async (kind, channel, error) => {
    expect(await sendTestNotification(kind, channel)).toEqual({ error });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("needs a member record, and won't send while in sudo", async () => {
    mocks.identity.mockResolvedValueOnce(null);
    expect(await sendTestNotification("intro_nudge", "slack")).toEqual({ error: expect.stringContaining("no member record") });

    mocks.identity.mockResolvedValueOnce({ memberId: "m-fern", isSudo: true });
    expect(await sendTestNotification("intro_nudge", "slack")).toEqual({ error: expect.stringContaining("Exit sudo") });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("passes on why a channel couldn't send", async () => {
    mocks.send.mockResolvedValue({ ok: false, error: "No Slack account is matched to your member record." });

    expect(await sendTestNotification("intro_nudge", "slack")).toEqual({ error: "No Slack account is matched to your member record." });
  });
});
