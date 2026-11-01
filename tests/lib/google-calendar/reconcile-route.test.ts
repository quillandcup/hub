import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  config: { isProduction: true },
  ensure: vi.fn(),
  sync: vi.fn(),
  ping: vi.fn(),
  sweep: vi.fn(),
  reprocess: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  APP_URL: "https://app.example.test",
  get isProduction() {
    return mocks.config.isProduction;
  },
}));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: async () => ({ user: { id: "u" } }) }));
vi.mock("@/lib/processing/trigger", () => ({ triggerCalendarSync: mocks.sync, triggerReprocessing: mocks.reprocess }));
vi.mock("@/lib/google-calendar/incremental-sync", () => ({ sweepCancelledEvents: mocks.sweep }));
vi.mock("@/lib/cron-heartbeats", () => ({ pingCronHeartbeat: mocks.ping }));
vi.mock("@/lib/google-calendar/client", () => ({ GoogleCalendarClient: class {} }));
vi.mock("@/lib/google-calendar/watch", () => ({ ensureCalendarWatchChannel: mocks.ensure }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

import { GET } from "@/app/api/reconcile/calendar/route";

const call = (query = "") => GET(new NextRequest(`http://localhost/api/reconcile/calendar${query}`));

describe("GET /api/reconcile/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.isProduction = true;
    process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN = "tok";
    mocks.sync.mockResolvedValue({ imported: 1 });
    mocks.sweep.mockResolvedValue({ cancelled: 0, deleted: 0, range: null });
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

  it("sweeps deletions outside the watched window, a week and a day back by default", async () => {
    mocks.sweep.mockResolvedValue({ cancelled: 2, deleted: 2, range: { from: "a", to: "b" } });
    const res = await call();
    expect(mocks.sweep).toHaveBeenCalledWith(expect.objectContaining({ sinceDays: 8, calendarId: "primary" }));
    expect((await res.json()).cancelled).toMatchObject({ deleted: 2 });
    // It hands the sweep a way to reprocess just the dates it touched.
    const { reprocess } = mocks.sweep.mock.calls[0][0];
    await reprocess({ from: new Date("2026-02-05T00:00:00Z"), to: new Date("2026-02-07T00:00:00Z") });
    expect(mocks.reprocess).toHaveBeenCalledWith("calendar_events", "bronze", { dateRange: expect.anything() });
  });

  it.each([["?cancelledSinceDays=30", 30], ["?cancelledSinceDays=9999", 365], ["?cancelledSinceDays=0", 8], ["?cancelledSinceDays=soon", 8]])(
    "reads %s as %s days",
    async (query, days) => {
      await call(query);
      expect(mocks.sweep).toHaveBeenCalledWith(expect.objectContaining({ sinceDays: days }));
    }
  );

  it("fails visibly, without the heartbeat, when the sweep fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.sweep.mockRejectedValue(new Error("google down"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(mocks.ping).not.toHaveBeenCalled();
  });
});
