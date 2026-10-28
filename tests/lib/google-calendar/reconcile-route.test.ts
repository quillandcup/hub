import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  config: { isProduction: true },
  ensure: vi.fn(),
  sync: vi.fn(),
  ping: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  APP_URL: "https://app.example.test",
  get isProduction() {
    return mocks.config.isProduction;
  },
}));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: async () => ({ user: { id: "u" } }) }));
vi.mock("@/lib/processing/trigger", () => ({ triggerCalendarSync: mocks.sync }));
vi.mock("@/lib/cron-heartbeats", () => ({ pingCronHeartbeat: mocks.ping }));
vi.mock("@/lib/google-calendar/client", () => ({ GoogleCalendarClient: class {} }));
vi.mock("@/lib/google-calendar/watch", () => ({ ensureCalendarWatchChannel: mocks.ensure }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

import { GET } from "@/app/api/reconcile/calendar/route";

const call = () => GET(new NextRequest("http://localhost/api/reconcile/calendar"));

describe("GET /api/reconcile/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.isProduction = true;
    process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN = "tok";
    mocks.sync.mockResolvedValue({ imported: 1 });
    mocks.ensure.mockResolvedValue({ action: "kept", channelId: "c", expiresAt: "2026-11-01T00:00:00Z" });
  });

  it("renews the push channel for the production webhook URL, then syncs and pings", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ address: "https://app.example.test/api/webhooks/calendar", token: "tok" })
    );
    expect(mocks.sync).toHaveBeenCalled();
    expect(mocks.ping).toHaveBeenCalledWith("reconcile-calendar");
    expect((await res.json()).watch.action).toBe("kept");
  });

  it("does not open a channel outside production, and still syncs", async () => {
    mocks.config.isProduction = false;
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect((await res.json()).watch.action).toBe("skipped");
  });

  it("syncs but fails visibly, without the heartbeat, when the channel can't be opened", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.ensure.mockRejectedValue(new Error("forbidden"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(mocks.sync).toHaveBeenCalled();
    expect(mocks.ping).not.toHaveBeenCalled();
    expect((await res.json()).error).toContain("forbidden");
  });

  it("fails visibly when the webhook token isn't configured", async () => {
    delete process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
    const res = await call();
    expect(res.status).toBe(500);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.ping).not.toHaveBeenCalled();
  });
});
