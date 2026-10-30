import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const requireAdmin = vi.fn();
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: (request: unknown) => requireAdmin(request) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ marker: "service" }) }));
const enforce = vi.fn();
vi.mock("@/lib/retention/network-details", () => ({ enforceNetworkRetention: (db: unknown) => enforce(db) }));
const pingCronHeartbeat = vi.fn();
vi.mock("@/lib/cron-heartbeats", () => ({ pingCronHeartbeat: (name: string) => pingCronHeartbeat(name) }));

import { GET } from "@/app/api/reconcile/retention/route";

const request = () => new NextRequest("http://localhost/api/reconcile/retention");
const RESULT = { devicesStored: { access_events: 4, video_watch_segments: 0, analytics_events: 2 }, removed: { access_events: 9, video_watch_segments: 1 }, stoppedEarly: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireAdmin.mockResolvedValue({ user: { id: "admin" }, forbidden: false });
  enforce.mockResolvedValue(RESULT);
});

describe("GET /api/reconcile/retention", () => {
  it("runs the job with the service-role client, pings its heartbeat and returns what it did", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, reconciliation: "retention", ...RESULT });
    expect(enforce).toHaveBeenCalledWith({ marker: "service" });
    expect(pingCronHeartbeat).toHaveBeenCalledWith("reconcile-retention");
  });

  it("refuses an anonymous caller and a non-admin, and runs nothing", async () => {
    requireAdmin.mockResolvedValueOnce({ user: null });
    expect((await GET(request())).status).toBe(401);
    requireAdmin.mockResolvedValueOnce({ user: { id: "member" }, forbidden: true });
    expect((await GET(request())).status).toBe(403);
    expect(enforce).not.toHaveBeenCalled();
  });

  it("reports a failure as 500 and does not ping the heartbeat, so the monitor notices", async () => {
    enforce.mockRejectedValue(new Error("retention_set_device(access_events): boom"));
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "retention_set_device(access_events): boom" });
    expect(pingCronHeartbeat).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the error has none", async () => {
    enforce.mockRejectedValue({});
    const res = await GET(request());
    expect(await res.json()).toEqual({ error: "Failed to enforce network retention" });
  });
});
