import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFakeClock } from "@/tests/helpers/fake-clock";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const { postMessage, tokensUsed, config, getSlackUserToken, repos } = vi.hoisted(() => ({
  postMessage: vi.fn(),
  tokensUsed: [] as (string | undefined)[],
  config: { isProduction: true },
  getSlackUserToken: vi.fn(),
  repos: { current: null as unknown },
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
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos.current,
}));

const { sendFiles } = vi.hoisted(() => ({ sendFiles: vi.fn() }));
vi.mock("@/lib/chat/slack-upload", () => ({ sendChatFilesToSlack: sendFiles }));

import { chatSlackWritesEnabled, escapeForSlack, hubMessageMetadata, retryUnsentChatMessages, sendChatMessageToSlack } from "@/lib/chat/slack-post";

const CHANNEL = "chn_AAAAAAAAAAA1";
const ID = "msg_AAAAAAAAAAA1";
const ROOT_ID = "msg_AAAAAAAAAAA2";
const MESSAGE = {
  id: ID,
  channel_id: CHANNEL,
  origin: "app",
  slack_sync_status: "pending",
  author_member_id: "member-fern",
  created_at: "2026-10-10T11:00:00.000Z",
};
const ROOT = { id: ROOT_ID, channel_id: CHANNEL, origin: "slack", slack_ts: "1699999999.000100", created_at: "2026-10-10T10:00:00.000Z" };

let dataset: InMemoryDataset;
const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ error: null }));
/** Only the Slack connection helpers reach the client now; the chat rows go through the repository. */
const supabase = { rpc };

const stateOf = (id: string) => dataset.chatMessages.find((m) => m.id === id);
const chat = () => (repos.current as Repos).chat;

beforeEach(() => {
  // Chat posting does not depend on SLACK_TEST_MODE, even if it is enabled in production.
  vi.stubEnv("SLACK_TEST_MODE", "true");
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
  config.isProduction = true;
  getSlackUserToken.mockReset();
  // Chat requires a connected account, so a member normally has one.
  getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
  postMessage.mockReset();
  postMessage.mockResolvedValue({ ok: true, ts: "1700000000.000100" });
  rpc.mockClear();
  tokensUsed.length = 0;
  dataset = new InMemoryDataset({
    chatChannels: [{ id: CHANNEL, slack_channel_id: "C_HOSTS" }],
    chatMessages: [{ ...MESSAGE }, { ...ROOT }],
    chatMessageContents: [{ message_id: ID, body: "Hello <everyone> & friends" }],
  });
  repos.current = createInMemoryRepos(dataset);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("escapeForSlack / hubMessageMetadata", () => {
  it("escapes the three characters mrkdwn treats as syntax, so plain Hub text can't mention or link", () => {
    expect(escapeForSlack("<!channel> a & b")).toBe("&lt;!channel&gt; a &amp; b");
    // A mention or channel the member picked stays a real one; every other angle-bracket form is text.
    expect(escapeForSlack("hi <@U123ABC> in <#C0GEN1> <!here> <https://x.test|link> <@lower>")).toBe(
      "hi <@U123ABC> in <#C0GEN1> &lt;!here&gt; &lt;https://x.test|link&gt; &lt;@lower&gt;"
    );
  });

  it("marks a post with our message id", () => {
    expect(hubMessageMetadata("m1")).toEqual({ event_type: "hub_message", event_payload: { app_message_id: "m1" } });
  });
});

describe("sendChatMessageToSlack", () => {
  it("posts as the member with their own token and our metadata (no bot name or photo), and records the ts and how it was posted", async () => {
    await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("sent");

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [args, token] = postMessage.mock.calls[0];
    expect(token).toBe("xoxp-fern");
    expect(args).toEqual({
      channel: "C_HOSTS",
      text: "Hello &lt;everyone&gt; &amp; friends",
      thread_ts: undefined,
      unfurl_links: false,
      unfurl_media: false,
      metadata: hubMessageMetadata(ID),
    });
    expect(stateOf(ID)).toMatchObject({ slack_ts: "1700000000.000100", slack_sync_status: "sent", posted_via: "user_token" });
  });

  it("replies in the root's thread", async () => {
    stateOf(ID)!.thread_root_id = ROOT_ID;
    await sendChatMessageToSlack(supabase as never, ID);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ thread_ts: "1699999999.000100" }), "xoxp-fern");
  });

  it("marks the message failed when Slack throws or says no", async () => {
    postMessage.mockRejectedValueOnce(new Error("channel_not_found"));
    await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("failed");
    expect(stateOf(ID)?.slack_sync_status).toBe("failed");

    stateOf(ID)!.slack_sync_status = "pending";
    postMessage.mockResolvedValueOnce({ ok: false });
    await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("failed");
    expect(stateOf(ID)?.slack_sync_status).toBe("failed");
  });

  it("marks it failed when the thread root never reached Slack", async () => {
    stateOf(ID)!.thread_root_id = ROOT_ID;
    stateOf(ROOT_ID)!.slack_ts = null;
    await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("failed");
    expect(postMessage).not.toHaveBeenCalled();
    expect(stateOf(ID)?.slack_sync_status).toBe("failed");
  });

  it("leaves a sent, deleted or Slack-origin message alone", async () => {
    for (const change of [{ slack_sync_status: "sent" }, { deleted_at: "2026-10-01T00:00:00Z" }, { origin: "slack" }]) {
      Object.assign(stateOf(ID)!, MESSAGE, { deleted_at: null }, change);
      await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("skipped");
    }
    await expect(sendChatMessageToSlack(supabase as never, "msg_ZZZZZZZZZZZZ")).resolves.toBe("skipped");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("never reaches a real channel off production: the message stays pending", async () => {
    config.isProduction = false;
    await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("skipped");
    expect(postMessage).not.toHaveBeenCalled();
    expect(stateOf(ID)?.slack_sync_status).toBe("pending");
    expect(chatSlackWritesEnabled()).toBe(false);
  });

  it("fails a message that has no author, channel or text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dataset.chatMessageContents = [];
    await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("failed");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("still posts when only recording how it was posted fails, and leaves the message pending when recording the ts fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(chat(), "setPostedVia").mockRejectedValueOnce(new Error("posted_via is down"));
    await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("sent");
    expect(stateOf(ID)?.slack_sync_status).toBe("sent");
    expect(stateOf(ID)?.posted_via ?? null).toBeNull();
    expect(error).not.toHaveBeenCalled();

    stateOf(ID)!.slack_sync_status = "pending";
    vi.spyOn(chat(), "markSent").mockRejectedValueOnce(new Error("database is down"));
    await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("sent");
    expect(stateOf(ID)?.slack_sync_status).toBe("pending");
    expect(error).toHaveBeenCalledWith("chat_mark_message_sent failed for %s:", ID, "database is down");

    vi.spyOn(chat(), "markSent").mockRejectedValueOnce("odd");
    await sendChatMessageToSlack(supabase as never, ID);
    expect(error).toHaveBeenCalledWith("chat_mark_message_sent failed for %s:", ID, "odd");
  });

  it("reports why, and still answers failed, when even recording the failure fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(chat(), "markFailed").mockRejectedValueOnce(new Error("database is down"));
    postMessage.mockRejectedValueOnce(new Error("boom"));
    await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("failed");
    expect(error).toHaveBeenCalledWith("chat_mark_message_failed failed for %s:", ID, expect.any(Error));
  });

  describe("without a working Slack connection", () => {
    beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

    it("posts nothing, not even through the bot, and marks the message failed so it waits for a Retry", async () => {
      getSlackUserToken.mockResolvedValue(null);
      await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("failed");
      expect(postMessage).not.toHaveBeenCalled();
      expect(stateOf(ID)?.slack_sync_status).toBe("failed");
    });

    it("revokes the connection, so the member is sent to reconnect, and fails when Slack says their token is dead", async () => {
      postMessage.mockRejectedValueOnce({ data: { error: "token_revoked" } });
      await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("failed");
      expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });
      expect(stateOf(ID)?.slack_sync_status).toBe("failed");
      expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it("fails, without revoking, on any other Slack error", async () => {
      postMessage.mockRejectedValueOnce({ data: { error: "channel_not_found" } });
      await expect(sendChatMessageToSlack(supabase as never, ID)).resolves.toBe("failed");
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(rpc).not.toHaveBeenCalledWith("slack_connection_revoke", expect.anything());
    });
  });
});

describe("retryUnsentChatMessages", () => {
  useFakeClock(() => Date.parse("2026-10-10T12:00:00Z"));

  const unsent = (id: string, createdAt: string, status = "pending") => ({
    id,
    channel_id: CHANNEL,
    origin: "app",
    slack_sync_status: status,
    author_member_id: "member-fern",
    created_at: createdAt,
  });

  it("retries unsent messages between two minutes and a day old, oldest first, and counts the results", async () => {
    dataset.chatMessages = [
      unsent("msg_AAAAAAAAAAA5", "2026-10-10T11:30:00.000Z", "failed"),
      unsent("msg_AAAAAAAAAAA4", "2026-10-10T11:00:00.000Z"),
      unsent("msg_AAAAAAAAAAA6", "2026-10-10T11:59:00.000Z"), // inside the two minutes: still being sent
      unsent("msg_AAAAAAAAAAA7", "2026-10-09T11:00:00.000Z"), // over a day: expired, not retried
    ];
    dataset.chatMessageContents = [
      { message_id: "msg_AAAAAAAAAAA4", body: "first" },
      { message_id: "msg_AAAAAAAAAAA5", body: "second" },
    ];
    postMessage.mockResolvedValueOnce({ ok: true, ts: "1.1" }).mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(retryUnsentChatMessages(supabase as never)).resolves.toEqual({ sent: 1, failed: 1, expired: 1 });

    expect(postMessage.mock.calls.map(([args]) => args.text)).toEqual(["first", "second"]);
    expect(stateOf("msg_AAAAAAAAAAA4")?.slack_sync_status).toBe("sent");
    expect(stateOf("msg_AAAAAAAAAAA5")?.slack_sync_status).toBe("failed");
    expect(stateOf("msg_AAAAAAAAAAA6")?.slack_sync_status).toBe("pending");
    expect(stateOf("msg_AAAAAAAAAAA7")?.slack_sync_status).toBe("failed");
  });

  it("marks a message still pending after the window as failed, so its author can retry it, and doesn't send it", async () => {
    dataset.chatMessages = [unsent("msg_AAAAAAAAAAA8", "2026-10-09T12:00:00.000Z"), unsent("msg_AAAAAAAAAAA9", "2026-10-01T12:00:00.000Z")];

    await expect(retryUnsentChatMessages(supabase as never)).resolves.toEqual({ sent: 0, failed: 0, expired: 2 });

    expect(dataset.chatMessages.map((m) => m.slack_sync_status)).toEqual(["failed", "failed"]);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("sendChatMessageToSlack with files", () => {
  it("hands a message with files (and no text) to the file upload instead of chat.postMessage", async () => {
    sendFiles.mockResolvedValue("sent");
    stateOf(ID)!.thread_root_id = ROOT_ID;
    dataset.chatMessageContents = [
      { message_id: ID, body: "", files: [{ id: "pending-1", name: "cat.gif", mimetype: "image/gif", staged: "staging/x/y/cat.gif" }] },
    ];

    expect(await sendChatMessageToSlack(supabase as never, ID)).toBe("sent");

    expect(postMessage).not.toHaveBeenCalled();
    expect(sendFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: ID,
        slackChannelId: "C_HOSTS",
        threadTs: "1699999999.000100",
        body: "",
        files: [expect.objectContaining({ id: "pending-1", staged: "staging/x/y/cat.gif" })],
      })
    );
  });

  it("still fails a message with neither text nor files", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendFiles.mockClear();
    dataset.chatMessageContents = [{ message_id: ID, body: "" }];
    expect(await sendChatMessageToSlack(supabase as never, ID)).toBe("failed");
    expect(sendFiles).not.toHaveBeenCalled();
  });
});
