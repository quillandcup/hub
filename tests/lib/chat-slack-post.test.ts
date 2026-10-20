import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const { postMessage, tokensUsed, config, getSlackUserToken } = vi.hoisted(() => ({
  postMessage: vi.fn(),
  tokensUsed: [] as (string | undefined)[],
  config: { isProduction: true },
  getSlackUserToken: vi.fn(),
}));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function (token?: string) {
    tokensUsed.push(token);
    return { chat: { postMessage: (args: unknown) => postMessage(args, token) } };
  }),
}));
vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  get isProduction() {
    return config.isProduction;
  },
}));
vi.mock("@/lib/slack-connect", async (original) => ({
  ...(await original<typeof import("@/lib/slack-connect")>()),
  getSlackUserToken: (...args: unknown[]) => getSlackUserToken(...args),
}));

import { chatSlackWritesEnabled, escapeForSlack, hubMessageMetadata, retryUnsentChatMessages, sendChatMessageToSlack } from "@/lib/chat/slack-post";

interface Fixture {
  message: Record<string, unknown> | null;
  root: { slack_ts: string | null } | null;
  author: Record<string, unknown> | null;
  unsent: { id: string }[];
  expired: { id: string }[];
}

const MESSAGE = {
  id: "m1",
  origin: "app",
  slack_sync_status: "pending",
  deleted_at: null,
  author_member_id: "member-fern",
  thread_root_id: null,
  chat_message_contents: { body: "Hello <everyone> & friends" },
  chat_channels: { slack_channel_id: "C_HOSTS" },
};

let fixture: Fixture;
const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ error: null }));
const retryFilters: { method: string; args: unknown[] }[] = [];
const updates: { table: string; values: unknown }[] = [];

/** Just enough of the Supabase client for the outbox: reads by table, and the two rpc calls. */
const supabase = {
  rpc,
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      if (table === "chat_messages") retryFilters.push({ method, args });
      return chain;
    };
    for (const m of ["select", "eq", "in", "is", "lt", "lte", "gt", "order"]) chain[m] = record(m);
    chain.update = (values: unknown) => {
      updates.push({ table, values });
      // update(...).select("id") answers with the rows it changed (the expiry of old pending messages).
      chain.select = () => Promise.resolve({ data: fixture.expired });
      return chain;
    };
    chain.limit = () => Promise.resolve({ data: fixture.unsent });
    chain.maybeSingle = () => {
      const eq = retryFilters.filter((f) => f.method === "eq" && f.args[0] === "id").at(-1)?.args[1];
      if (table === "member_directory") return Promise.resolve({ data: fixture.author });
      return Promise.resolve({ data: eq === "root-1" ? fixture.root : fixture.message });
    };
    return chain;
  },
};

beforeEach(() => {
  // Chat posting does not depend on SLACK_TEST_MODE, even if it is enabled in production.
  vi.stubEnv("SLACK_TEST_MODE", "true");
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
  config.isProduction = true;
  getSlackUserToken.mockReset();
  getSlackUserToken.mockResolvedValue(null);
  postMessage.mockReset();
  postMessage.mockResolvedValue({ ok: true, ts: "1700000000.000100" });
  rpc.mockClear();
  retryFilters.length = 0;
  updates.length = 0;
  tokensUsed.length = 0;
  fixture = {
    message: { ...MESSAGE },
    root: { slack_ts: "1699999999.000100" },
    author: { name: "Fern Quillsby", display_name: "Fern", photo_url: "https://photos.example.test/fern.jpg" },
    unsent: [],
    expired: [],
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("escapeForSlack / hubMessageMetadata", () => {
  it("escapes the three characters mrkdwn treats as syntax, so plain Hub text can't mention or link", () => {
    expect(escapeForSlack("<!channel> a & b")).toBe("&lt;!channel&gt; a &amp; b");
  });

  it("marks a post with our message id", () => {
    expect(hubMessageMetadata("m1")).toEqual({ event_type: "hub_message", event_payload: { app_message_id: "m1" } });
  });
});

describe("sendChatMessageToSlack", () => {
  it("posts as the bot under the member's name and photo, with our metadata, and records the ts", async () => {
    await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("sent");

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C_HOSTS",
        text: "Hello &lt;everyone&gt; &amp; friends",
        username: "Fern",
        icon_url: "https://photos.example.test/fern.jpg",
        thread_ts: undefined,
        unfurl_links: false,
        metadata: hubMessageMetadata("m1"),
      }),
      "xoxb-test"
    );
    expect(rpc).toHaveBeenCalledWith("chat_mark_message_sent", { p_message_id: "m1", p_slack_ts: "1700000000.000100" });
  });

  it("replies in the root's thread", async () => {
    fixture.message = { ...MESSAGE, thread_root_id: "root-1" };
    await sendChatMessageToSlack(supabase as never, "m1");
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ thread_ts: "1699999999.000100" }), "xoxb-test");
  });

  it("drops a photo that isn't https", async () => {
    fixture.author = { name: "Fern Quillsby", display_name: null, photo_url: "javascript:alert(1)" };
    await sendChatMessageToSlack(supabase as never, "m1");
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ username: "Fern Quillsby", icon_url: undefined }), "xoxb-test");
  });

  it("marks the message failed when Slack throws or says no", async () => {
    postMessage.mockRejectedValueOnce(new Error("channel_not_found"));
    await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("failed");
    postMessage.mockResolvedValueOnce({ ok: false });
    await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("failed");
    expect(rpc.mock.calls.filter(([name]) => name === "chat_mark_message_failed")).toHaveLength(2);
  });

  it("marks it failed when the thread root never reached Slack", async () => {
    fixture.message = { ...MESSAGE, thread_root_id: "root-1" };
    fixture.root = { slack_ts: null };
    await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("failed");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("leaves a sent, deleted or Slack-origin message alone", async () => {
    for (const change of [{ slack_sync_status: "sent" }, { deleted_at: "2026-10-01T00:00:00Z" }, { origin: "slack" }]) {
      fixture.message = { ...MESSAGE, ...change };
      await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("skipped");
    }
    fixture.message = null;
    await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("skipped");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("never reaches a real channel off production: the message stays pending", async () => {
    config.isProduction = false;
    await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("skipped");
    expect(postMessage).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(chatSlackWritesEnabled()).toBe(false);
  });

  describe("for a member who connected Slack", () => {
    beforeEach(() => getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" }));

    it("posts as them with their own token: no bot name or photo, and records how it was posted", async () => {
      await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("sent");

      expect(postMessage).toHaveBeenCalledTimes(1);
      const [args, token] = postMessage.mock.calls[0];
      expect(token).toBe("xoxp-fern");
      expect(args).not.toHaveProperty("username");
      expect(args).not.toHaveProperty("icon_url");
      expect(args).toMatchObject({ channel: "C_HOSTS", metadata: hubMessageMetadata("m1") });
      expect(updates).toContainEqual({ table: "chat_messages", values: { posted_via: "user_token" } });
      expect(rpc).toHaveBeenCalledWith("chat_mark_message_sent", { p_message_id: "m1", p_slack_ts: "1700000000.000100" });
    });

    it("falls back to the bot, and revokes the connection, when Slack says their token is dead", async () => {
      postMessage.mockRejectedValueOnce({ data: { error: "token_revoked" } });
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("sent");

      expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });
      expect(postMessage).toHaveBeenCalledTimes(2);
      expect(postMessage.mock.calls[1][1]).toBe("xoxb-test");
      expect(postMessage.mock.calls[1][0]).toMatchObject({ username: "Fern" });
      expect(updates.some((u) => JSON.stringify(u.values).includes("user_token"))).toBe(false);
    });

    it("fails, rather than also posting through the bot, on any other Slack error", async () => {
      postMessage.mockRejectedValueOnce({ data: { error: "channel_not_found" } });
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("failed");
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("chat_mark_message_failed", { p_message_id: "m1" });
      expect(rpc).not.toHaveBeenCalledWith("slack_connection_revoke", expect.anything());
    });
  });

  it("fails without a bot token instead of throwing", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("failed");
  });
});

describe("retryUnsentChatMessages", () => {
  useFakeClock(() => Date.parse("2026-10-10T12:00:00Z"));

  it("retries unsent messages between two minutes and a day old, oldest first, and counts the results", async () => {
    fixture.unsent = [{ id: "m1" }, { id: "m2" }];
    postMessage.mockResolvedValueOnce({ ok: true, ts: "1.1" }).mockRejectedValueOnce(new Error("boom"));

    await expect(retryUnsentChatMessages(supabase as never)).resolves.toEqual({ sent: 1, failed: 1, expired: 0 });

    const filter = (method: string) => retryFilters.filter((f) => f.method === method);
    expect(filter("lt")[0].args).toEqual(["created_at", "2026-10-10T11:58:00.000Z"]);
    expect(filter("gt")[0].args).toEqual(["created_at", "2026-10-09T12:00:00.000Z"]);
    expect(filter("order")[0].args).toEqual(["created_at", { ascending: true }]);
    expect(filter("in")[0].args).toEqual(["slack_sync_status", ["pending", "failed"]]);
  });

  it("marks a message still pending after the window as failed, so its author can retry it, and doesn't send it", async () => {
    fixture.expired = [{ id: "old-1" }, { id: "old-2" }];

    await expect(retryUnsentChatMessages(supabase as never)).resolves.toEqual({ sent: 0, failed: 0, expired: 2 });

    expect(updates).toContainEqual({ table: "chat_messages", values: { slack_sync_status: "failed" } });
    const filter = (method: string) => retryFilters.filter((f) => f.method === method);
    expect(filter("eq")).toContainEqual({ method: "eq", args: ["slack_sync_status", "pending"] });
    expect(filter("lte")[0].args).toEqual(["created_at", "2026-10-09T12:00:00.000Z"]);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
