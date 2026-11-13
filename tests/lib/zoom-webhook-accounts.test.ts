import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import type { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { PRIMARY_ZOOM_ACCOUNT_ID } from "@/lib/zoom-accounts";

// The webhook accepts a request signed with any configured account's secret and records which account it came from.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => void | Promise<void>) => {
    void callback();
  },
}));
const triggerZoomImport = vi.fn(async (_options: unknown) => ({ success: true }));
vi.mock("@/lib/processing/trigger", () => ({ triggerZoomImport: (o: unknown) => triggerZoomImport(o) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { POST } from "@/app/api/webhooks/zoom/route";

const PRIMARY_SECRET = "primary-test-secret";
const SECONDARY_SECRET = "secondary-test-secret";

function signed(payload: unknown, secret: string | null) {
  const body = JSON.stringify(payload);
  const timestamp = "1700000000";
  const headers = new Headers({ "x-zm-request-timestamp": timestamp });
  if (secret) headers.set("x-zm-signature", `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`);
  return new Request("http://localhost/api/webhooks/zoom", { method: "POST", headers, body }) as unknown as NextRequest;
}

const joined = (uuid: string) => ({
  event: "meeting.participant_joined",
  event_ts: 1700000000000,
  payload: {
    object: {
      uuid,
      id: 555,
      host_id: "host-1",
      participant: { participant_uuid: "pp-1", user_name: "Ada Example", join_time: "2026-10-01T13:00:00Z" },
    },
  },
});

describe("Zoom webhook with two accounts", () => {
  let secondaryId: string;

  beforeEach(async () => {
    process.env.ZOOM_WEBHOOK_SECRET_TOKEN = PRIMARY_SECRET;
    process.env.ZOOM_SECONDARY_WEBHOOK_SECRET_TOKEN = SECONDARY_SECRET;
    dataset = new InMemoryDataset();
    repos = createInMemoryRepos(dataset);
    secondaryId = (await repos.zoom.createAccount({ slug: "secondary", label: "Secondary", hostEmail: null, defaultPolicy: "exclude", credentialsPrefix: "ZOOM_SECONDARY" })).id;
    triggerZoomImport.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.ZOOM_SECONDARY_WEBHOOK_SECRET_TOKEN;
    vi.restoreAllMocks();
  });

  it("accepts the primary secret and records the primary account", async () => {
    const res = await POST(signed(joined("uuid-p"), PRIMARY_SECRET));

    expect(res.status).toBe(200);
    expect(dataset.zoomParticipantEvents.map((e) => [e.meeting_uuid, e.zoom_account])).toEqual([["uuid-p", PRIMARY_ZOOM_ACCOUNT_ID]]);
  });

  it("accepts the secondary secret and records the secondary account", async () => {
    const res = await POST(signed(joined("uuid-s"), SECONDARY_SECRET));

    expect(res.status).toBe(200);
    expect(dataset.zoomParticipantEvents.map((e) => [e.meeting_uuid, e.zoom_account])).toEqual([["uuid-s", secondaryId]]);
  });

  it("refuses an unsigned request and one signed with an unknown secret", async () => {
    expect((await POST(signed(joined("uuid-x"), null))).status).toBe(401);
    expect((await POST(signed(joined("uuid-x"), "someone-elses-secret"))).status).toBe(401);
    expect(dataset.zoomParticipantEvents).toEqual([]);
  });

  it("does not accept the secondary secret when the secondary account has none configured", async () => {
    delete process.env.ZOOM_SECONDARY_WEBHOOK_SECRET_TOKEN;

    expect((await POST(signed(joined("uuid-s"), SECONDARY_SECRET))).status).toBe(401);
  });

  it("answers an endpoint validation with the signing account's secret", async () => {
    const res = await POST(signed({ event: "endpoint.url_validation", payload: { plainToken: "abc" } }, SECONDARY_SECRET));

    expect(await res.json()).toEqual({ plainToken: "abc", encryptedToken: createHmac("sha256", SECONDARY_SECRET).update("abc").digest("hex") });
  });

  it("imports only the account the meeting-ended event came from", async () => {
    const ended = { event: "meeting.ended", payload: { object: { uuid: "uuid-s", id: 555, start_time: "2026-10-01T13:00:00Z", end_time: "2026-10-01T14:00:00Z" } } };

    vi.useFakeTimers();
    try {
      await POST(signed(ended, SECONDARY_SECRET));
      // The import waits 10 seconds for Zoom to finalize; no HTTP here, so fake timers are safe.
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
    expect(triggerZoomImport).toHaveBeenCalledWith({ fromDate: "2026-10-01", toDate: "2026-10-01", account: "secondary" });
  });

  it("falls back to the primary account when the accounts cannot be read", async () => {
    repos.zoom.accounts = async () => {
      throw new Error("database down");
    };

    expect((await POST(signed(joined("uuid-p"), PRIMARY_SECRET))).status).toBe(200);
    expect((await POST(signed(joined("uuid-s"), SECONDARY_SECRET))).status).toBe(401);
  });
});
