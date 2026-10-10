import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const postMessage = vi.fn();
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function () {
    return { chat: { postMessage } };
  }),
}));

import { escapeForSlack, hubMessageMetadata, retryUnsentChatMessages, sendChatMessageToSlack } from "@/lib/chat/slack-post";

interface Fixture {
  message: Record<string, unknown> | null;
  root: { slack_ts: string | null } | null;
  author: Record<string, unknown> | null;
  unsent: { id: string }[];
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

/** Just enough of the Supabase client for the outbox: reads by table, and the two rpc calls. */
const supabase = {
  rpc,
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      if (table === "chat_messages") retryFilters.push({ method, args });
      return chain;
    };
    for (const m of ["select", "eq", "in", "is", "lt", "gt", "order"]) chain[m] = record(m);
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
  vi.stubEnv("SLACK_TEST_MODE", "false");
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
  postMessage.mockReset();
  postMessage.mockResolvedValue({ ok: true, ts: "1700000000.000100" });
  rpc.mockClear();
  retryFilters.length = 0;
  fixture = {
    message: { ...MESSAGE },
    root: { slack_ts: "1699999999.000100" },
    author: { name: "Fern Quillsby", display_name: "Fern", photo_url: "https://photos.example.test/fern.jpg" },
    unsent: [],
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
      })
    );
    expect(rpc).toHaveBeenCalledWith("chat_mark_message_sent", { p_message_id: "m1", p_slack_ts: "1700000000.000100" });
  });

  it("replies in the root's thread", async () => {
    fixture.message = { ...MESSAGE, thread_root_id: "root-1" };
    await sendChatMessageToSlack(supabase as never, "m1");
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ thread_ts: "1699999999.000100" }));
  });

  it("drops a photo that isn't https", async () => {
    fixture.author = { name: "Fern Quillsby", display_name: null, photo_url: "javascript:alert(1)" };
    await sendChatMessageToSlack(supabase as never, "m1");
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ username: "Fern Quillsby", icon_url: undefined }));
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

  it("never reaches a real channel in test mode: the message stays pending", async () => {
    vi.stubEnv("SLACK_TEST_MODE", "true");
    await expect(sendChatMessageToSlack(supabase as never, "m1")).resolves.toBe("skipped");
    expect(postMessage).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
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

    await expect(retryUnsentChatMessages(supabase as never)).resolves.toEqual({ sent: 1, failed: 1 });

    const filter = (method: string) => retryFilters.filter((f) => f.method === method);
    expect(filter("lt")[0].args).toEqual(["created_at", "2026-10-10T11:58:00.000Z"]);
    expect(filter("gt")[0].args).toEqual(["created_at", "2026-10-09T12:00:00.000Z"]);
    expect(filter("order")[0].args).toEqual(["created_at", { ascending: true }]);
    expect(filter("in")[0].args).toEqual(["slack_sync_status", ["pending", "failed"]]);
  });
});
