import { describe, it, expect, vi, beforeEach } from "vitest";
import { useFakeClock } from "@/tests/helpers/fake-clock";

// tests/setup.ts replaces getSlackBotToken for every file; this one tests the real thing.
vi.unmock("@/lib/slack-bot-token");
const slack = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function () {
    return { oauth: { v2: { access: slack.access } } };
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { botTokenStatus, forgetSlackBotToken, getSlackBotToken } from "@/lib/slack-bot-token";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const HOUR = 3600_000;
const PRIMARY = { id: "slws_AAAAAAAAAAA1", is_primary: true };
const SECOND = { id: "slws_AAAAAAAAAAA2", is_primary: false };

/** Two workspaces' credentials as the SQL keeps them: the primary's in the original storage, the others' by workspace id. */
function fakeDb() {
  const stored = new Map<string, { access: string; refresh: string; expires: number }>();
  const leases = new Set<string>();
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const row = (r?: { access: string; refresh: string; expires: number }) => ({
    data: r ? [{ access_token: r.access, refresh_token: r.refresh, expires_at: new Date(r.expires).toISOString() }] : [],
    error: null,
  });
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "slack_bot_token_get") return row(stored.get("primary"));
    if (name === "slack_workspace_token_get") return row(stored.get(args!.p_workspace_id as string));
    if (name === "slack_token_refresh_claim") {
      const key = args!.p_key as string;
      if (leases.has(key)) return { data: false, error: null };
      leases.add(key);
      return { data: true, error: null };
    }
    if (name === "slack_token_refresh_release") {
      leases.delete(args!.p_key as string);
      return { data: null, error: null };
    }
    const save = (key: string, leaseKey: string) => {
      stored.set(key, { access: args!.p_access_token as string, refresh: args!.p_refresh_token as string, expires: Date.parse(args!.p_expires_at as string) });
      leases.delete(leaseKey);
      return { data: null, error: null };
    };
    if (name === "slack_bot_token_save") return save("primary", "bot");
    if (name === "slack_workspace_token_save") return save(args!.p_workspace_id as string, `bot:${args!.p_workspace_id}`);
    return { data: null, error: null };
  });
  return { stored, leases, calls, rpc, client: { rpc } as never as import("@supabase/supabase-js").SupabaseClient };
}

describe("the bot token of each Slack workspace", () => {
  useFakeClock(() => NOW);
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    forgetSlackBotToken();
    slack.access.mockReset();
    vi.stubEnv("SLACK_CLIENT_ID", "client-1");
    vi.stubEnv("SLACK_CLIENT_SECRET", "secret-1");
    db = fakeDb();
  });

  it("reads the primary workspace's token where it always was, and another's by its workspace id", async () => {
    db.stored.set("primary", { access: "xoxb-primary", refresh: "r1", expires: NOW + 10 * HOUR });
    db.stored.set(SECOND.id, { access: "xoxb-second", refresh: "r2", expires: NOW + 10 * HOUR });

    expect(await getSlackBotToken(db.client)).toBe("xoxb-primary");
    expect(await getSlackBotToken(db.client, PRIMARY)).toBe("xoxb-primary");
    expect(await getSlackBotToken(db.client, SECOND)).toBe("xoxb-second");
    expect(db.calls.map((c) => c.name)).toContain("slack_workspace_token_get");
    expect(db.calls.find((c) => c.name === "slack_workspace_token_get")?.args).toEqual({ p_workspace_id: SECOND.id });

    // Each is cached on its own: asking again reads nothing.
    db.rpc.mockClear();
    expect(await getSlackBotToken(db.client, SECOND)).toBe("xoxb-second");
    expect(await getSlackBotToken(db.client)).toBe("xoxb-primary");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("is undefined for a workspace with no token stored", async () => {
    db.stored.set("primary", { access: "xoxb-primary", refresh: "r1", expires: NOW + 10 * HOUR });
    expect(await getSlackBotToken(db.client, SECOND)).toBeUndefined();
  });

  it("refreshes another workspace's token under its own lease and saves it to its own storage, leaving the primary's alone", async () => {
    db.stored.set("primary", { access: "xoxb-primary", refresh: "r1", expires: NOW + 10 * HOUR });
    db.stored.set(SECOND.id, { access: "xoxb-old", refresh: "r2", expires: NOW + 10 * 60_000 });
    slack.access.mockResolvedValue({ ok: true, access_token: "xoxb-new", refresh_token: "r3", expires_in: 43200 });

    expect(await getSlackBotToken(db.client, SECOND)).toBe("xoxb-new");

    expect(slack.access).toHaveBeenCalledWith(expect.objectContaining({ grant_type: "refresh_token", refresh_token: "r2" }));
    expect(db.calls.find((c) => c.name === "slack_token_refresh_claim")?.args).toMatchObject({ p_key: `bot:${SECOND.id}` });
    expect(db.calls.find((c) => c.name === "slack_workspace_token_save")?.args).toMatchObject({ p_workspace_id: SECOND.id, p_access_token: "xoxb-new", p_refresh_token: "r3" });
    expect(db.calls.map((c) => c.name)).not.toContain("slack_bot_token_save");
    expect(db.stored.get("primary")?.access).toBe("xoxb-primary");
    expect(db.leases.size).toBe(0);
  });

  it("refreshes the primary workspace's token under the original lease key and storage", async () => {
    db.stored.set("primary", { access: "xoxb-old", refresh: "r1", expires: NOW + 10 * 60_000 });
    slack.access.mockResolvedValue({ ok: true, access_token: "xoxb-new", refresh_token: "r2", expires_in: 43200 });

    expect(await getSlackBotToken(db.client, PRIMARY)).toBe("xoxb-new");
    expect(db.calls.find((c) => c.name === "slack_token_refresh_claim")?.args).toMatchObject({ p_key: "bot" });
    expect(db.calls.map((c) => c.name)).toContain("slack_bot_token_save");
  });

  it("reports when a workspace's token expires", async () => {
    db.stored.set(SECOND.id, { access: "xoxb-second", refresh: "r2", expires: NOW + HOUR });
    expect(await botTokenStatus(db.client, SECOND)).toEqual({ expiresAt: new Date(NOW + HOUR) });
    expect(await botTokenStatus(db.client)).toBeNull();
  });
});
