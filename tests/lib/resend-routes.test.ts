import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { EMAIL_ACTIVITY_SOURCE } from "@/lib/email-events";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const NOW_MS = Date.parse("2097-01-10T12:00:00Z");

const ADA = "mbr_AAAAAAAAAAA1";
let dataset: InMemoryDataset;
let failWith: Error | null = null;

vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async (request: NextRequest) =>
    request.headers.get("authorization") === "Bearer cron"
      ? { user: { id: "cron" }, forbidden: false, supabase: {} }
      : request.headers.get("authorization") === "Bearer member"
        ? { user: { id: "u1" }, forbidden: true, supabase: {} }
        : { user: null, forbidden: true, supabase: {} },
}));
vi.mock("@/lib/cron-heartbeats", () => ({ pingCronHeartbeat: vi.fn(async () => undefined) }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => {
    const repos = createInMemoryRepos(dataset);
    if (failWith) repos.resendEvents.record = async () => Promise.reject(failWith);
    return repos;
  },
}));

import { GET as reconcile } from "@/app/api/reconcile/email/route";
import { POST as webhook } from "@/app/api/webhooks/resend/route";

const KEY = Buffer.from("route-test-signing-key");
const SECRET = `whsec_${KEY.toString("base64")}`;

const signedRequest = (payload: unknown, over: { id?: string; secret?: Buffer; timestamp?: number; raw?: string } = {}) => {
  const body = over.raw ?? JSON.stringify(payload);
  const id = over.id ?? "msg_1";
  const timestamp = String(over.timestamp ?? Math.floor(NOW_MS / 1000));
  const signature = `v1,${createHmac("sha256", over.secret ?? KEY).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
  return new NextRequest("http://localhost/api/webhooks/resend", {
    method: "POST",
    body,
    headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
  });
};

const sent = {
  type: "email.sent",
  created_at: "2097-01-10T11:59:00.000Z",
  data: { email_id: "em_1", from: "Hub <hub@example.com>", to: ["ada@example.com"], subject: "Ready?", tags: { kind: "prickle_checkin" } },
};

beforeEach(() => {
  vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
  dataset = new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example", email: "ada@example.com" }] });
  failWith = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/webhooks/resend", () => {
  useFakeClock(() => NOW_MS);

  it("stores a signed event and puts it on the member's timeline", async () => {
    const response = await webhook(signedRequest(sent));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, stored: true, rows: 1 });
    expect(dataset.resendEvents).toHaveLength(1);
    expect(dataset.activities.filter((a) => a.source === EMAIL_ACTIVITY_SOURCE).map((a) => [a.member_id, a.activity_type, a.title])).toEqual([
      [ADA, "email_sent", "Email sent: Ready?"],
    ]);
  });

  it("treats a retry of the same delivery as a no-op", async () => {
    await webhook(signedRequest(sent));
    await webhook(signedRequest(sent));
    expect(dataset.resendEvents).toHaveLength(1);
    expect(dataset.activities.filter((a) => a.source === EMAIL_ACTIVITY_SOURCE)).toHaveLength(1);
  });

  it("builds up an email's rows as its events arrive", async () => {
    await webhook(signedRequest(sent, { id: "msg_1" }));
    await webhook(signedRequest({ ...sent, type: "email.opened", created_at: "2097-01-10T12:00:00.000Z" }, { id: "msg_2" }));
    expect(dataset.activities.filter((a) => a.source === EMAIL_ACTIVITY_SOURCE).map((a) => a.activity_type)).toEqual(["email_sent", "email_opened"]);
  });

  it("rejects a bad signature, an old timestamp and a missing secret, storing nothing", async () => {
    expect((await webhook(signedRequest(sent, { secret: Buffer.from("other") }))).status).toBe(401);
    expect((await webhook(signedRequest(sent, { timestamp: Math.floor(NOW_MS / 1000) - 3600 }))).status).toBe(401);
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await webhook(signedRequest(sent))).status).toBe(401);
    expect(dataset.resendEvents).toEqual([]);
  });

  it("answers 400 to a signed body that is not JSON", async () => {
    expect((await webhook(signedRequest(null, { raw: "not json" }))).status).toBe(400);
  });

  it("acknowledges an event type it does not keep without storing it", async () => {
    const response = await webhook(signedRequest({ ...sent, type: "email.received" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, stored: false });
    expect(dataset.resendEvents).toEqual([]);
  });

  it("answers 500 when storing fails, so Resend retries", async () => {
    failWith = new Error("database is down");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await webhook(signedRequest(sent))).status).toBe(500);
    spy.mockRestore();
  });
});

describe("GET /api/reconcile/email", () => {
  useFakeClock(() => NOW_MS);

  const request = (auth: string | null, query = "") =>
    new NextRequest(`http://localhost/api/reconcile/email${query}`, { headers: auth ? { authorization: auth } : {} });
  const listing = (created: string) =>
    new Response(JSON.stringify({ has_more: false, data: [{ id: "em_9", to: ["ada@example.com"], from: "Hub", subject: "Hi", created_at: created, last_event: "delivered" }] }));

  it("needs an admin or the cron secret", async () => {
    expect((await reconcile(request(null))).status).toBe(401);
    expect((await reconcile(request("Bearer member"))).status).toBe(403);
  });

  it("fails clearly without an API key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect((await reconcile(request("Bearer cron"))).status).toBe(500);
  });

  it("pulls the last three days by default, or the days asked for, up to 90", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    const fetchMock = vi.fn().mockImplementation(async () => listing("2097-01-10T10:00:00Z"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await reconcile(request("Bearer cron"));
    expect(await response.json()).toMatchObject({ success: true, reconciliation: "email", days: 3, listed: 1, recovered: 2, projected: 1 });
    expect(dataset.activities.filter((a) => a.source === EMAIL_ACTIVITY_SOURCE)).toHaveLength(1);

    expect((await (await reconcile(request("Bearer cron", "?days=30"))).json()).days).toBe(30);
    expect((await (await reconcile(request("Bearer cron", "?days=9999"))).json()).days).toBe(90);
    expect((await (await reconcile(request("Bearer cron", "?days=abc"))).json()).days).toBe(3);
    vi.unstubAllGlobals();
  });

  it("answers 500 with Resend's complaint when the key cannot list emails", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_sending_only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"name":"restricted_api_key"}', { status: 401 })));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await reconcile(request("Bearer cron"));

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/restricted_api_key/);
    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});
