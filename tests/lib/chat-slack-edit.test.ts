import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { reportRefused } = vi.hoisted(() => ({ reportRefused: vi.fn() }));
vi.mock("@/lib/chat/blocks-refused", () => ({ reportRefusedBlocks: (...args: unknown[]) => reportRefused(...args) }));
const { update, remove, upload, config, getSlackUserToken } = vi.hoisted(() => ({
  upload: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  config: { isProduction: true },
  getSlackUserToken: vi.fn(),
}));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function (token?: string) {
    return { files: { delete: (a: unknown) => remove(a, token) }, filesUploadV2: (a: unknown) => upload(a, token), chat: { update: (a: unknown) => update(a, token), delete: (a: unknown) => remove(a, token) } };
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
  posted_via: "user_token",
  slack_ts: "1700000000.000100",
  deleted_at: null,
  chat_channels: { slack_channel_id: "C_HOSTS" },
};
/** The message the repository holds in these tests (null: none); `chat_channels` is its channel's Slack id. */
let row: (Record<string, unknown> & { chat_channels: { slack_channel_id: string } }) | null;
const rpc = vi.fn(async () => ({ error: null }));
/** Only the Slack connection helpers reach the client; the message is read through the repository. */
const service = { rpc } as never;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    createRepos: () => {
      const { chat_channels, ...message } = row ?? { chat_channels: { slack_channel_id: "" } };
      return actual.createInMemoryRepos(
        new InMemoryDataset({
          chatChannels: [{ id: "chn_AAAAAAAAAAA1", slack_channel_id: chat_channels.slack_channel_id }],
          chatMessages: row ? [{ ...message, id: "m1", channel_id: "chn_AAAAAAAAAAA1" } as never] : [],
        })
      );
    },
  };
});
const EDIT = { messageId: "m1", memberId: "member-fern", body: "fixed <typo> & more" };
const DELETE = { messageId: "m1", memberId: "member-fern" };

beforeEach(() => {
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
  config.isProduction = true;
  row = { ...ROW };
  getSlackUserToken.mockReset();
  getSlackUserToken.mockResolvedValue({ token: "xoxp-fern", slackUserId: "U_FERN" });
  update.mockReset();
  upload.mockReset();
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
  it("edits a message posted as the member with the member's own token, escaping the text and keeping our metadata", async () => {
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      { channel: "C_HOSTS", ts: "1700000000.000100", text: "fixed &lt;typo&gt; &amp; more", blocks: [], metadata: hubMessageMetadata("m1") },
      "xoxp-fern"
    );
  });

  it("sends a Hub message with an underline as rich-text blocks, with its text minus the underline as the fallback", async () => {
    await updateChatMessageInSlack(service, { ...EDIT, body: "fixed <u>this</u> & *that*" });
    expect(update).toHaveBeenCalledWith(
      {
        channel: "C_HOSTS",
        ts: "1700000000.000100",
        text: "fixed this &amp; *that*",
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: "fixed " },
                  { type: "text", text: "this", style: { underline: true } },
                  { type: "text", text: " & " },
                  { type: "text", text: "that", style: { bold: true } },
                ],
              },
            ],
          },
        ],
        metadata: hubMessageMetadata("m1"),
      },
      "xoxp-fern"
    );
  });

  it("sends an edited message with a list as rich-text blocks, and falls back to its text when Slack refuses them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportRefused.mockClear();
    await updateChatMessageInSlack(service, { ...EDIT, body: "1. one\n2. two" });
    expect(update.mock.calls[0][0].blocks[0].elements[0]).toMatchObject({ type: "rich_text_list", style: "ordered" });
    expect(update.mock.calls[0][0].text).toBe("1. one\n2. two");

    update.mockReset();
    update.mockResolvedValue({ ok: true });
    update.mockRejectedValueOnce({ data: { error: "invalid_blocks" } });
    await expect(updateChatMessageInSlack(service, { ...EDIT, body: "• a" })).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][0]).toMatchObject({ text: "• a", blocks: [] });
    expect(reportRefused).toHaveBeenCalledWith(expect.anything(), "edit", "m1", { data: { error: "invalid_blocks" } });

    // Plain text has nothing to fall back from.
    update.mockReset();
    update.mockRejectedValueOnce({ data: { error: "invalid_blocks" } });
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toMatchObject({ ok: false });
    expect(update).toHaveBeenCalledTimes(1);
    expect(reportRefused).toHaveBeenCalledTimes(1);
  });

  it("sends a Slack-written message with an underline as rich-text blocks read from its Slack text (escapes and all)", async () => {
    row = { ...ROW, origin: "slack", posted_via: null };
    await updateChatMessageInSlack(service, { ...EDIT, body: "a &lt; b <u>u</u> <@U1>" });
    const [args] = update.mock.calls[0];
    expect(args.text).toBe("a &lt; b u <@U1>");
    expect(args.blocks[0].elements[0].elements).toEqual([
      { type: "text", text: "a < b " },
      { type: "text", text: "u", style: { underline: true } },
      { type: "text", text: " " },
      { type: "user", user_id: "U1" },
    ]);
  });

  it.each([
    ["edit", () => updateChatMessageInSlack(service, EDIT)],
    ["delete", () => deleteChatMessageInSlack(service, DELETE)],
  ])("won't %s a message the bot posted for a member, which only the bot could change and which no longer acts for one", async (_what, run) => {
    row = { ...ROW, posted_via: "bot" };
    await expect(run()).resolves.toEqual({ ok: false, error: expect.stringContaining("posted by Billie Bot") });
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("asks the member to reconnect when their message can't be edited without their token, or the token is dead", async () => {
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

  it("edits a message written in Slack as the member, with Slack's own text and no old blocks, and without the Hub's tag", async () => {
    row = { ...ROW, origin: "slack", posted_via: null };
    await expect(updateChatMessageInSlack(service, { ...EDIT, body: "*fixed* <@U1> & more" })).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ channel: "C_HOSTS", ts: "1700000000.000100", text: "*fixed* <@U1> & more", blocks: [] }, "xoxp-fern");
  });

  it("clears the message's link previews only when asked (the rewrite of a pasted lesson address)", async () => {
    row = { ...ROW, origin: "slack", posted_via: null };
    await updateChatMessageInSlack(service, { ...EDIT, body: "text", dropPreviews: true });
    expect(update).toHaveBeenCalledWith({ channel: "C_HOSTS", ts: "1700000000.000100", text: "text", blocks: [], attachments: [] }, "xoxp-fern");
  });

  it("needs the member's own Slack connection for a message written in Slack", async () => {
    row = { ...ROW, origin: "slack", posted_via: null };
    getSlackUserToken.mockResolvedValueOnce(null);
    await expect(updateChatMessageInSlack(service, EDIT)).resolves.toEqual({ ok: false, error: expect.stringMatching(/^Connect Slack in Settings/) });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses someone else's message, a notice Slack posted, a deleted one and an unknown one", async () => {
    for (const change of [{ author_member_id: "member-gale" }, { system_subtype: "channel_join" }, { deleted_at: "2026-10-01T00:00:00Z" }]) {
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

describe("updateChatMessageInSlack with files", () => {
  const buf = Buffer.from("x");
  it("uploads the new files as the member without sharing them, then edits with the old file ids and the new ones", async () => {
    upload.mockResolvedValue({ ok: true, files: [{ ok: true, files: [{ id: "FNEW" }] }] });
    const result = await updateChatMessageInSlack(service, { ...EDIT, addFiles: { existingIds: ["FOLD"], uploads: [{ file: buf, filename: "a.png" }] } });
    expect(result).toEqual({ ok: true, fileIds: ["FNEW"] });
    expect(upload).toHaveBeenCalledWith({ file_uploads: [{ file: buf, filename: "a.png" }] }, "xoxp-fern");
    expect(upload.mock.calls[0][0]).not.toHaveProperty("channel_id");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ file_ids: ["FOLD", "FNEW"] }), "xoxp-fern");
  });

  it("changes nothing in Slack when it gives back fewer files than were uploaded, or when the message never reached Slack", async () => {
    upload.mockResolvedValue({ ok: true, files: [] });
    expect(await updateChatMessageInSlack(service, { ...EDIT, addFiles: { existingIds: [], uploads: [{ file: buf, filename: "a.png" }] } })).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
    row = { ...ROW, slack_ts: null };
    expect(await updateChatMessageInSlack(service, { ...EDIT, addFiles: { existingIds: [], uploads: [{ file: buf, filename: "a.png" }] } })).toMatchObject({ ok: false });
  });

  it("sends no file_ids when no files were added", async () => {
    await updateChatMessageInSlack(service, EDIT);
    expect(update.mock.calls[0][0]).not.toHaveProperty("file_ids");
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("deleteChatMessageInSlack", () => {
  it("deletes as the member, with their own token", async () => {
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith({ channel: "C_HOSTS", ts: "1700000000.000100" }, "xoxp-fern");
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

  it("deletes a message written in Slack as the member, and needs their connection to", async () => {
    row = { ...ROW, origin: "slack", posted_via: null };
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith({ channel: "C_HOSTS", ts: "1700000000.000100" }, "xoxp-fern");

    getSlackUserToken.mockResolvedValueOnce(null);
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: false, error: expect.stringMatching(/^Connect Slack in Settings/) });
  });

  it("refuses someone else's message and a notice Slack posted, and explains a dead token or a refusal", async () => {
    row = { ...ROW, author_member_id: "member-gale" };
    await expect(deleteChatMessageInSlack(service, DELETE)).resolves.toEqual({ ok: false, error: "That message can't be deleted." });
    row = { ...ROW, system_subtype: "channel_join" };
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
  it("deletes the file as the member who posted the message", async () => {
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith({ file: "F1" }, "xoxp-fern");
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
    remove.mockRejectedValueOnce(new Error("network down"));
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toMatchObject({ ok: false });
    row = { ...ROW, author_member_id: "someone-else" };
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toMatchObject({ ok: false });
  });
  it("asks to reconnect Slack when the member's token is dead", async () => {
    row = { ...ROW, posted_via: "user_token" };
    remove.mockRejectedValueOnce({ data: { error: "invalid_auth" } });
    await expect(deleteChatFileInSlack(service, FILE)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Reconnect Slack") });
    expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });
  });
});
