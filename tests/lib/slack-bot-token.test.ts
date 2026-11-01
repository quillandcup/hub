import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const slack = vi.hoisted(() => ({ access: vi.fn(), exchange: vi.fn() }));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function () {
    return { oauth: { v2: { access: slack.access, exchange: slack.exchange } } };
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => db.client }));

import { botTokenStatus, exchangeBotToken, forgetSlackBotToken, getSlackBotToken, rotationEnabled, seedBotToken } from "@/lib/slack-bot-token";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const HOUR = 3600_000;

/** The database side of the bot token, with the lease rules the SQL has: one holder at a time. */
const db = (() => {
  const state = {
    row: null as { access: string; refresh: string | null; expires: number | null } | null,
    leaseHeld: false,
    saveFailures: 0,
    reads: [] as ({ access: string; refresh: string | null; expires: number | null } | null)[],
    calls: [] as string[],
  };
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    state.calls.push(name);
    if (name === "slack_bot_token_get") {
      const row = state.reads.length > 0 ? (state.reads.length > 1 ? state.reads.shift() : state.reads[0]) : state.row;
      return { data: row ? [{ access_token: row.access, refresh_token: row.refresh, expires_at: row.expires === null ? null : new Date(row.expires).toISOString() }] : [], error: null };
    }
    if (name === "slack_token_refresh_claim") {
      if (state.leaseHeld) return { data: false, error: null };
      state.leaseHeld = true;
      return { data: true, error: null };
    }
    if (name === "slack_token_refresh_release") {
      state.leaseHeld = false;
      return { data: null, error: null };
    }
    if (name === "slack_bot_token_save") {
      if (state.saveFailures > 0) {
        state.saveFailures--;
        return { data: null, error: new Error("write failed") };
      }
      state.row = { access: args!.p_access_token as string, refresh: args!.p_refresh_token as string, expires: Date.parse(args!.p_expires_at as string) };
      state.leaseHeld = false;
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
  return { state, rpc, client: { rpc } as never as import("@supabase/supabase-js").SupabaseClient };
})();

const store = (access: string, expiresInMs: number | null, refresh: string | null = "xoxe-refresh-1") => {
  db.state.row = { access, refresh, expires: expiresInMs === null ? null : NOW + expiresInMs };
};

const refreshed = (suffix = "2") => ({ ok: true, access_token: `xoxe.xoxb-${suffix}`, refresh_token: `xoxe-refresh-${suffix}`, expires_in: 43200 });

beforeEach(() => {
  forgetSlackBotToken();
  db.rpc.mockClear();
  db.state.row = null;
  db.state.leaseHeld = false;
  db.state.saveFailures = 0;
  db.state.reads = [];
  db.state.calls = [];
  slack.access.mockReset();
  slack.exchange.mockReset();
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-from-env");
  vi.stubEnv("SLACK_BOT_TOKEN_ROTATION", "on");
  vi.stubEnv("SLACK_CLIENT_ID", "client-1");
  vi.stubEnv("SLACK_CLIENT_SECRET", "secret-1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getSlackBotToken", () => {
  useFakeClock(() => NOW);

  it("is the environment variable, and touches no database, until rotation is switched on", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN_ROTATION", "");
    store("xoxe.xoxb-stored", 5 * HOUR);
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxb-from-env");
    expect(db.rpc).not.toHaveBeenCalled();
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    await expect(getSlackBotToken(db.client)).resolves.toBeUndefined();
  });

  it.each([["1", true], ["true", true], ["On", true], ["off", false], ["", false]])("reads SLACK_BOT_TOKEN_ROTATION=%j as %s", (value, on) => {
    vi.stubEnv("SLACK_BOT_TOKEN_ROTATION", value);
    expect(rotationEnabled()).toBe(on);
  });

  it("keeps using the environment variable until the exchange has stored a rotating token, so switching on early is harmless", async () => {
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxb-from-env");
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    await expect(getSlackBotToken(db.client)).resolves.toBeUndefined();
  });

  it("reads a token with time left from the database, and then from memory without asking again", async () => {
    store("xoxe.xoxb-stored", 5 * HOUR);
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-stored");
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-stored");
    expect(db.state.calls).toEqual(["slack_bot_token_get"]);
    expect(slack.access).not.toHaveBeenCalled();
  });

  it("refreshes a token in its last hour with the refresh token, stores the new pair, and uses the new token", async () => {
    store("xoxe.xoxb-old", 30 * 60_000, "xoxe-refresh-1");
    slack.access.mockResolvedValue(refreshed());

    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-2");
    expect(slack.access).toHaveBeenCalledWith({ client_id: "client-1", client_secret: "secret-1", grant_type: "refresh_token", refresh_token: "xoxe-refresh-1" });
    expect(db.rpc).toHaveBeenCalledWith("slack_bot_token_save", { p_access_token: "xoxe.xoxb-2", p_refresh_token: "xoxe-refresh-2", p_expires_at: new Date(NOW + 43200_000).toISOString() });
    // Now in memory: no more database reads until it is close to expiring again.
    db.rpc.mockClear();
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-2");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("refreshes only once when many requests find it expiring at the same moment", async () => {
    store("xoxe.xoxb-old", 30 * 60_000, "xoxe-refresh-1");
    // Slack answers only when told to, so the other requests arrive while the first is still refreshing.
    let answer: () => void = () => {};
    const gate = new Promise<void>((resolve) => (answer = resolve));
    slack.access.mockImplementation(async () => {
      await gate;
      return refreshed();
    });

    const requests = Array.from({ length: 6 }, () => getSlackBotToken(db.client));
    for (let tick = 0; tick < 100; tick++) await Promise.resolve();
    expect(db.state.calls.filter((c) => c === "slack_token_refresh_claim")).toHaveLength(6);
    answer();
    const results = await Promise.all(requests);

    expect(slack.access).toHaveBeenCalledTimes(1);
    // The one that refreshed has the new token; the rest, whose old token was still good, used that.
    expect(results.every((t) => t === "xoxe.xoxb-2" || t === "xoxe.xoxb-old")).toBe(true);
    expect(results).toContain("xoxe.xoxb-2");
    expect(db.state.row).toMatchObject({ access: "xoxe.xoxb-2", refresh: "xoxe-refresh-2" });
    expect(db.state.leaseHeld).toBe(false);
  });

  it("looks again once it holds the lease: a refresh that finished between its read and its claim has spent the refresh token it read", async () => {
    const stale = { access: "xoxe.xoxb-old", refresh: "xoxe-refresh-1", expires: NOW + 30 * 60_000 };
    const done = { access: "xoxe.xoxb-by-someone-else", refresh: "xoxe-refresh-2", expires: NOW + 12 * HOUR };
    db.state.reads = [stale, done];

    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-by-someone-else");
    expect(slack.access).not.toHaveBeenCalled();
  });

  it("waits for whoever is refreshing when its own token has already expired", async () => {
    db.state.leaseHeld = true;
    db.state.reads = [
      { access: "xoxe.xoxb-expired", refresh: "xoxe-refresh-1", expires: NOW - 1000 },
      { access: "xoxe.xoxb-expired", refresh: "xoxe-refresh-1", expires: NOW - 1000 },
      { access: "xoxe.xoxb-new", refresh: "xoxe-refresh-2", expires: NOW + 12 * HOUR },
    ];
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-new");
    expect(slack.access).not.toHaveBeenCalled();
  });

  it("carries on with the old token when a refresh fails while it still works, and tries again next time", async () => {
    store("xoxe.xoxb-old", 30 * 60_000);
    slack.access.mockRejectedValue(new Error("slack is down"));
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-old");
    expect(db.state.leaseHeld).toBe(false);

    slack.access.mockResolvedValue(refreshed());
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-2");
  });

  it("throws, once it has expired and could not be refreshed, rather than hand out a dead token", async () => {
    store("xoxe.xoxb-old", -1000);
    slack.access.mockRejectedValue(new Error("invalid_refresh_token"));
    await expect(getSlackBotToken(db.client)).rejects.toThrow("expired and could not be refreshed");
  });

  it.each([
    ["no new token", { ok: true, refresh_token: "r", expires_in: 1 }],
    ["no new refresh token", { ok: true, access_token: "a", expires_in: 1 }],
    ["not ok", { ok: false }],
  ])("treats a Slack answer with %s as a failed refresh and stores nothing", async (_label, answer) => {
    store("xoxe.xoxb-old", 30 * 60_000);
    slack.access.mockResolvedValue(answer);
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-old");
    expect(db.rpc).not.toHaveBeenCalledWith("slack_bot_token_save", expect.anything());
  });

  it("retries storing the new pair, since the refresh token it came from is spent", async () => {
    store("xoxe.xoxb-old", 30 * 60_000);
    slack.access.mockResolvedValue(refreshed());
    db.state.saveFailures = 2;
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-2");
    expect(db.state.calls.filter((c) => c === "slack_bot_token_save")).toHaveLength(3);
  });

  it("says so loudly when it can't store it at all, but uses the new token Slack just gave: failing every bot call would be worse", async () => {
    store("xoxe.xoxb-old", 30 * 60_000);
    slack.access.mockResolvedValue(refreshed());
    db.state.saveFailures = 10;
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-2");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("CRITICAL"), expect.anything());
    // And it keeps using it, without asking Slack again, while it lasts.
    slack.access.mockClear();
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-2");
    expect(slack.access).not.toHaveBeenCalled();
  });

  it("treats a token with no expiry as always fresh", async () => {
    store("xoxb-never-expires", null, null);
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxb-never-expires");
    expect(slack.access).not.toHaveBeenCalled();
  });
});

describe("seedBotToken (recovery after a reinstall)", () => {
  useFakeClock(() => NOW);

  it("stores the pair as already expired, so the first use refreshes it and the app stores what it gets back", async () => {
    store("xoxe.xoxb-dead", -1000, "xoxe-dead-refresh");
    await seedBotToken(db.client, "xoxe.xoxb-seed", "xoxe-seed-refresh");
    expect(db.state.row).toMatchObject({ access: "xoxe.xoxb-seed", refresh: "xoxe-seed-refresh", expires: NOW });

    slack.access.mockResolvedValue(refreshed("9"));
    await expect(getSlackBotToken(db.client)).resolves.toBe("xoxe.xoxb-9");
    expect(slack.access).toHaveBeenCalledWith(expect.objectContaining({ refresh_token: "xoxe-seed-refresh" }));
    expect(db.state.row).toMatchObject({ access: "xoxe.xoxb-9", refresh: "xoxe-refresh-9" });
  });

  it("says so when it can't store them", async () => {
    db.state.saveFailures = 1;
    await expect(seedBotToken(db.client, "a", "r")).rejects.toThrow("Could not store the tokens");
  });
});

describe("exchangeBotToken", () => {
  useFakeClock(() => NOW);

  it("trades the long-lived token for a rotating one and stores it", async () => {
    slack.exchange.mockResolvedValue({ ok: true, access_token: "xoxe.xoxb-1", refresh_token: "xoxe-refresh-1", expires_in: 43200 });
    const { expiresAt } = await exchangeBotToken(db.client, "xoxb-long-lived");
    expect(slack.exchange).toHaveBeenCalledWith({ client_id: "client-1", client_secret: "secret-1", token: "xoxb-long-lived" });
    expect(expiresAt.getTime()).toBe(NOW + 43200_000);
    expect(db.state.row).toMatchObject({ access: "xoxe.xoxb-1", refresh: "xoxe-refresh-1" });
  });

  it("fails if Slack doesn't return a rotating token, and says so plainly if it can't be stored (the exchange can't be repeated)", async () => {
    slack.exchange.mockResolvedValue({ ok: false });
    await expect(exchangeBotToken(db.client, "xoxb-long-lived")).rejects.toThrow("did not return a rotating token");

    slack.exchange.mockResolvedValue({ ok: true, access_token: "a", refresh_token: "r", expires_in: 1 });
    db.state.saveFailures = 1;
    await expect(exchangeBotToken(db.client, "xoxb-long-lived")).rejects.toThrow("can't be repeated");
  });

  it("reports whether a rotating token is stored and when it expires, never the token", async () => {
    await expect(botTokenStatus(db.client)).resolves.toBeNull();
    store("xoxe.xoxb-1", 5 * HOUR);
    const status = await botTokenStatus(db.client);
    expect(status?.expiresAt?.getTime()).toBe(NOW + 5 * HOUR);
    expect(JSON.stringify(status)).not.toContain("xoxe");
  });
});
