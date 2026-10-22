import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { update, remove, config, getSlackUserToken } = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  config: { isProduction: true },
  getSlackUserToken: vi.fn(),
}));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function (token?: string) {
    return { files: { delete: (a: unknown) => remove(a, token) }, chat: { update: (a: unknown) => update(a, token), delete: (a: unknown) => remove(a, token) } };
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

import { deleteChatFileInSlack, deleteChatMessageInSlack, updateChatMessageInSlack } from "@/lib/chat/slack-edit";
import { hubMessageMetadata } from "@/lib/chat/slack-post";

const ROW = {
  origin: "app",
  author_member_id: "member-fern",
  posted_via: "bot",
  slack_ts: "1700000000.000100",
  deleted_at: null,
  chat_channels: { slack_channel_id: "C_HOSTS" },
};
let row: Record<string, unknown> | null;
const rpc = vi.fn(async () => ({ error: null }));
const service = {
  rpc,
  from: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => ({ data: row });
    return chain;
  },
} as never;
const EDIT = { messageId: "m1", memberId: "member-fern", body: "fixed <typo> & more" };
const DELETE = { messageId: "m1", memberId: "member-fern" };

beforeEach(() => {
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
  config.isProduction = true;
  row = { ...ROW };
  getSlackUserToken.mockReset();
  getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
  update.mockReset();
  update.mockResolvedValue({ ok: true });
  remove.mockReset();
  remove.mockResolvedValue({ ok: true });
  rpc.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("updateChatMessageInSlack", () => {
  it("edits a bot-posted message with the bot's token, escaping the text and keeping our metadata", async () => {
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      { channel: "C_HOSTS", ts: "1700000000.000100", text: "fixed &lt;typo&gt; &amp; more", metadata: hubMessageMetadata("m1") },
      "xoxb-test"
    );
    expect(getSlackUserToken).not.toHaveBeenCalled();
  });

  it("edits a message posted as the member with the member's own token", async () => {
    row = { ...ROW, posted_via: "user_token" };
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toEqual({ ok: true });
    expect(update.mock.calls[0][1]).toBe("xoxp-fern");
  });

  it("asks the member to reconnect when their message can't be edited without their token, or the token is dead", async () => {
    row = { ...ROW, posted_via: "user_token" };
    getSlackUserToken.mockResolvedValueOnce(null);
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Reconnect Slack") });
    expect(update).not.toHaveBeenCalled();

    update.mockRejectedValueOnce({ data: { error: "token_revoked" } });
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Reconnect Slack") });
    expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });
  });

  it("does nothing in Slack for a message that never got there", async () => {
    row = { ...ROW, slack_ts: null };
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toEqual({ ok: true });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses someone else's message, one from Slack, a deleted one and an unknown one", async () => {
    for (const change of [{ author_member_id: "member-gale" }, { origin: "slack" }, { deleted_at: "2026-10-01T00:00:00Z" }]) {
      row = { ...ROW, ...change };
      await expect(updateChatMessageInSlack(service, EDIT)).resolves.toEqual({ ok: false, error: "That message can't be edited." });
    }
    row = null;
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("won't touch Slack off production", async () => {
    config.isProduction = false;
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("live Hub") });
    expect(update).not.toHaveBeenCalled();
  });

  it("says what went wrong when Slack refuses", async () => {
    update.mockRejectedValueOnce({ data: { error: "message_not_found" } });
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toEqual({ ok: false, error: "That message is no longer in Slack." });
    update.mockRejectedValueOnce({ data: { error: "cant_update_message" } });
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("any more") });
    update.mockRejectedValueOnce(new Error("offline"));
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Try again") });
  });
});

describe("deleteChatMessageInSlack", () => {
  it("deletes as whoever posted it", async () => {
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith({ channel: "C_HOSTS", ts: "1700000000.000100" }, "xoxb-test");

    row = { ...ROW, posted_via: "user_token" };
    await deleteChatMessageInSlack(service, DELETE);
    expect(remove.mock.calls[1][1]).toBe("xoxp-fern");
  });

  it("counts a message already gone from Slack as deleted, and one that never got there needs nothing", async () => {
    remove.mockRejectedValueOnce({ data: { error: "message_not_found" } });
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: true });

    row = { ...ROW, slack_ts: null };
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("deleting again after it was deleted is harmless", async () => {
    row = { ...ROW, deleted_at: "2026-10-01T00:00:00Z" };
    remove.mockRejectedValueOnce({ data: { error: "message_not_found" } });
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: true });
  });

  it("refuses someone else's message and one from Slack, and explains a dead token or a refusal", async () => {
    row = { ...ROW, author_member_id: "member-gale" };
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: false, error: "That message can't be deleted." });
    row = { ...ROW, origin: "slack" };
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toMatchObject({ ok: false });

    row = { ...ROW, posted_via: "user_token" };
    remove.mockRejectedValueOnce({ data: { error: "invalid_auth" } });
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Reconnect Slack") });
    expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });

    row = { ...ROW };
    remove.mockRejectedValueOnce({ data: { error: "cant_delete_message" } });
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: false, error: "Slack won't let this message be deleted." });
  });
});

describe("deleteChatFileInSlack", () => {
  const FILE = { ...DELETE, fileId: "F1" };
  it("deletes the file as whoever posted the message", async () => {
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith({ file: "F1" }, "xoxb-test");
  });
  it("treats a missing file or an unsent message as done, and reports other failures", async () => {
    remove.mockRejectedValueOnce({ data: { error: "file_not_found" } });
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toEqual({ ok: true });
    row = { ...ROW, slack_ts: null };
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toEqual({ ok: true });
    row = { ...ROW };
    remove.mockRejectedValueOnce({ data: { error: "boom" } });
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toMatchObject({ ok: false });
    remove.mockResolvedValueOnce({ ok: false });
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toMatchObject({ ok: false });
    row = { ...ROW, author_member_id: "someone-else" };
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toMatchObject({ ok: false });
  });
});
