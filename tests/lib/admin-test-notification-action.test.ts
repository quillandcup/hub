import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  identity: vi.fn(),
  send: vi.fn(),
  service: vi.fn(() => ({ service: true })),
  push: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: mocks.auth }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: mocks.identity }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/channels/web-push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channels/web-push")>()),
  sendDiagnosticPush: mocks.push,
}));
vi.mock("@/lib/notification-test", () => ({ sendTestNotification: mocks.send }));

import { sendDiagnosticPush, sendTestNotification } from "@/app/(admin)/admin/notifications/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: "admin-user" } });
  mocks.identity.mockResolvedValue({ memberId: "m-admin", isSudo: false });
  mocks.send.mockResolvedValue({ ok: true, sent: 1 });
  mocks.push.mockResolvedValue(2);
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

describe("sendDiagnosticPush action", () => {
  it("pushes to the admin's own devices, with a tag and high urgency only for the variants that ask", async () => {
    expect(await sendDiagnosticPush("tagged_urgent")).toEqual({ success: true, sent: 2 });
    expect(mocks.push).toHaveBeenCalledWith(
      { service: true },
      "m-admin",
      expect.objectContaining({ url: "/admin/notifications", tag: "prickle_checkin:diagnostic", requireInteraction: true }),
      { urgency: "high", ttlSeconds: 15 * 60 }
    );

    await sendDiagnosticPush("persistent");
    expect(mocks.push).toHaveBeenLastCalledWith(
      { service: true },
      "m-admin",
      expect.objectContaining({ tag: undefined }),
      { urgency: "normal", ttlSeconds: 24 * 60 * 60 }
    );
  });

  it("refuses a non-admin, an unknown variant, a missing member record and sudo before sending", async () => {
    mocks.auth.mockResolvedValueOnce({ ok: false, error: "Forbidden" });
    expect(await sendDiagnosticPush("tagged")).toEqual({ error: "Forbidden" });

    expect(await sendDiagnosticPush("toString")).toEqual({ error: "Unknown push variant" });

    mocks.identity.mockResolvedValueOnce(null);
    expect(await sendDiagnosticPush("tagged")).toEqual({ error: expect.stringContaining("no member record") });

    mocks.identity.mockResolvedValueOnce({ memberId: "m-fern", isSudo: true });
    expect(await sendDiagnosticPush("tagged")).toEqual({ error: expect.stringContaining("Exit sudo") });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("passes on why the push failed", async () => {
    mocks.push.mockRejectedValue(new Error("No live push subscriptions"));
    expect(await sendDiagnosticPush("tagged")).toEqual({ error: "No live push subscriptions" });

    mocks.push.mockRejectedValue("plain string");
    expect(await sendDiagnosticPush("tagged")).toEqual({ error: "plain string" });
  });
});
