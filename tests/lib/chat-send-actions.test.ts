import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEffectiveIdentity: vi.fn(),
  hasFeature: vi.fn(),
  rpc: vi.fn(),
  sendToSlack: vi.fn(),
  syncReaction: vi.fn(),
  slackUpdate: vi.fn(),
  slackDelete: vi.fn(),
  slackFileDelete: vi.fn(),
  removeBytes: vi.fn(),
  afterCallbacks: [] as (() => Promise<void> | void)[],
  slackReactionRows: [] as { id: string }[],
  retryRow: null as Record<string, unknown> | null,
  retryUnreadable: false,
  connected: vi.fn(),
  serviceClient: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (cb: () => Promise<void> | void) => void m.afterCallbacks.push(cb) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: m.getEffectiveIdentity }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: (key: string) => m.hasFeature(key),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: m.rpc,
    from: (table: string) => {
      throw new Error(`direct query on ${table}`);
    },
  }),
}));
// The message the retry looks at comes from the chat repository, here in memory.
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    createRepos: () => {
      const repos = actual.createInMemoryRepos(new InMemoryDataset({ chatMessages: m.retryRow ? [{ id: MESSAGE, channel_id: CHANNEL, ...m.retryRow }] : [] }));
      if (m.retryUnreadable) repos.chat.retryState = async () => { throw new Error("db down"); };
      return repos;
    },
  };
});
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: (...a: unknown[]) => m.connected(...a) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => m.serviceClient() }));
vi.mock("@/lib/chat/slack-post", () => ({ sendChatMessageToSlack: m.sendToSlack }));
vi.mock("@/lib/chat/slack-react", () => ({ syncReactionToSlack: m.syncReaction }));
vi.mock("@/lib/chat/slack-edit", () => ({ updateChatMessageInSlack: m.slackUpdate, deleteChatMessageInSlack: m.slackDelete, deleteChatFileInSlack: m.slackFileDelete }));
vi.mock("@/lib/chat/load", () => ({}));
vi.mock("@/lib/chat/file-cleanup", () => ({ removeChatFileBytes: m.removeBytes }));

import { deleteChatFile, deleteChatMessage, editChatMessage, prepareChatUploads, retryChatMessage, sendChatMessage, toggleChatReaction } from "@/app/(member)/chat/actions";

const CHANNEL = "chn_AAAAAAAAAAC1";
const MESSAGE = "msg_AAAAAAAAAAD1";
const flushAfter = async () => {
  while (m.afterCallbacks.length) await m.afterCallbacks.shift()!();
};

beforeEach(() => {
  m.serviceClient.mockReset().mockReturnValue({ service: true });
  m.removeBytes.mockReset();
  m.afterCallbacks.length = 0;
  m.getCurrentUser.mockResolvedValue({ id: "auth-1", email: "fern@example.test" });
  m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: false });
  m.hasFeature.mockResolvedValue(true);
  m.rpc.mockReset();
  m.sendToSlack.mockReset();
  m.syncReaction.mockReset();
  m.slackUpdate.mockReset();
  m.slackUpdate.mockResolvedValue({ ok: true });
  m.slackFileDelete.mockReset();
  m.slackFileDelete.mockResolvedValue({ ok: true });
  m.slackDelete.mockReset();
  m.slackDelete.mockResolvedValue({ ok: true });
  m.slackReactionRows = [];
  m.retryRow = { author_member_id: "member-fern", origin: "app", slack_sync_status: "failed" };
  m.retryUnreadable = false;
  m.connected.mockReset();
  m.connected.mockResolvedValue({ connected: true });
});

describe("retryChatMessage", () => {
  it("sends the author's own failed message again", async () => {
    m.sendToSlack.mockResolvedValue("sent");
    await expect(retryChatMessage(MESSAGE)).resolves.toEqual({ ok: true, id: MESSAGE });
    expect(m.sendToSlack).toHaveBeenCalledWith({ service: true }, MESSAGE);
  });

  it("says Slack didn't take it when the send fails again", async () => {
    m.sendToSlack.mockResolvedValue("failed");
    await expect(retryChatMessage(MESSAGE)).resolves.toEqual({ ok: false, error: "Slack didn't take it. Try again in a moment." });
  });

  it("sends nothing and says to connect Slack when the member has no working connection (no bot fallback)", async () => {
    m.connected.mockResolvedValue({ connected: false });
    await expect(retryChatMessage(MESSAGE)).resolves.toEqual({ ok: false, error: expect.stringContaining("Connect Slack in Settings") });
    expect(m.sendToSlack).not.toHaveBeenCalled();
  });

  it("refuses someone else's message, one from Slack, one already sent, an unknown one and a bad id", async () => {
    for (const change of [{ author_member_id: "member-gale" }, { origin: "slack" }, { slack_sync_status: "sent" }]) {
      m.retryRow = { author_member_id: "member-fern", origin: "app", slack_sync_status: "failed", ...change };
      await expect(retryChatMessage(MESSAGE)).resolves.toEqual({ ok: false, error: "That message can't be retried." });
    }
    m.retryRow = null;
    await expect(retryChatMessage(MESSAGE)).resolves.toMatchObject({ ok: false });
    await expect(retryChatMessage("nope")).resolves.toMatchObject({ ok: false });
    expect(m.sendToSlack).not.toHaveBeenCalled();
  });

  it("can't retry a message it can't read", async () => {
    m.retryUnreadable = true;
    await expect(retryChatMessage(MESSAGE)).resolves.toEqual({ ok: false, error: "That message can't be retried." });
    expect(m.sendToSlack).not.toHaveBeenCalled();
  });

  it("is closed without the posting preview", async () => {
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_posting");
    await expect(retryChatMessage(MESSAGE)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("isn't available") });
  });
});

describe("sendChatMessage", () => {
  it("returns as soon as the message is saved, and sends it to Slack after the response", async () => {
    m.rpc.mockResolvedValue({ data: MESSAGE, error: null });

    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toEqual({ ok: true, id: MESSAGE });
    expect(m.rpc).toHaveBeenCalledWith("chat_post_message", { p_channel_id: CHANNEL, p_body: "hello", p_thread_root_id: null });
    expect(m.sendToSlack).not.toHaveBeenCalled();

    await flushAfter();
    expect(m.sendToSlack).toHaveBeenCalledWith({ service: true }, MESSAGE);
  });

  it("refuses, saving nothing, when the member has no working Slack connection, since there is no bot fallback", async () => {
    m.connected.mockResolvedValue({ connected: false });
    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toEqual({ ok: false, error: "Connect Slack in Settings to post: your messages are posted as you." });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.afterCallbacks).toHaveLength(0);
  });

  it("never lets a failure in the background send surface as an error", async () => {
    m.rpc.mockResolvedValue({ data: MESSAGE, error: null });
    m.sendToSlack.mockRejectedValue(new Error("slack down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toMatchObject({ ok: true });
    await expect(flushAfter()).resolves.toBeUndefined();
  });

  it("saves nothing and sends nothing when the database refuses, with a message the member can act on", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "chat_post: archived" } });
    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toEqual({ ok: false, error: "This conversation is archived." });
    expect(m.afterCallbacks).toHaveLength(0);
  });

  it("is closed to a member without the chat_posting preview, and to sudo", async () => {
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_posting");
    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toMatchObject({ ok: false });

    m.hasFeature.mockResolvedValue(true);
    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: true });
    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toMatchObject({ ok: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

const MEMBER_ID = "member-fern";
const STAGED = `staging/2026-10-22/${MEMBER_ID}-11111111-2222-4333-8444-555555555555/cat.gif`;

/** A fake bucket: `listed` is what a folder listing returns; signed upload urls come back as tokens. */
function bucket(listed: { name: string; metadata?: { size: number } }[] = [{ name: "cat.gif", metadata: { size: 1234 } }]) {
  const createSignedUploadUrl = vi.fn(async (path: string) => ({ data: { token: `tok:${path}` }, error: null }));
  m.serviceClient.mockReturnValue({ storage: { from: () => ({ createSignedUploadUrl, list: async () => ({ data: listed }) }) } });
  return { createSignedUploadUrl };
}

describe("prepareChatUploads", () => {
  it("hands out one signed upload per file, in the member's own folder", async () => {
    const { createSignedUploadUrl } = bucket();
    const result = await prepareChatUploads([{ name: "cat.gif", size: 10 }, { name: "my notes.pdf", size: 20 }]);
    expect(result.ok).toBe(true);
    const paths = createSignedUploadUrl.mock.calls.map((c) => c[0]);
    expect(paths[0]).toMatch(new RegExp(`^staging/\\d{4}-\\d{2}-\\d{2}/${MEMBER_ID}-[0-9a-f-]{36}/cat\\.gif$`));
    expect(paths[1]).toMatch(/\/my_notes\.pdf$/);
    expect(result).toMatchObject({ uploads: [{ path: paths[0], token: `tok:${paths[0]}` }, { path: paths[1] }] });
  });

  it("refuses too many files, files that are too big, and callers who can't post", async () => {
    bucket();
    expect(await prepareChatUploads([])).toMatchObject({ ok: false });
    expect(await prepareChatUploads(Array.from({ length: 11 }, () => ({ name: "a", size: 1 })))).toMatchObject({ ok: false });
    expect(await prepareChatUploads([{ name: "big.mov", size: 21 * 1024 * 1024 }])).toMatchObject({ ok: false, error: expect.stringContaining("20 MB") });

    m.getEffectiveIdentity.mockResolvedValue({ memberId: MEMBER_ID, isSudo: true });
    expect(await prepareChatUploads([{ name: "a", size: 1 }])).toMatchObject({ ok: false });
  });

  it("says so when storage won't sign an upload", async () => {
    m.serviceClient.mockReturnValue({ storage: { from: () => ({ createSignedUploadUrl: async () => ({ data: null, error: { message: "nope" } }) }) } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await prepareChatUploads([{ name: "a", size: 1 }])).toEqual({ ok: false, error: "Couldn't start the upload. Try again." });
  });
});

describe("sendChatMessage with files", () => {
  const upload = { path: STAGED, name: "cat.gif", mimetype: "image/gif", size: 1 };

  it("saves the message with its staged files, using the size storage reports, and sends it after the response", async () => {
    bucket();
    m.rpc.mockResolvedValue({ data: MESSAGE, error: null });

    await expect(sendChatMessage(CHANNEL, "", undefined, [upload])).resolves.toEqual({ ok: true, id: MESSAGE });

    const args = m.rpc.mock.calls[0][1];
    expect(args.p_files).toEqual([{ id: expect.stringMatching(/^pending-/), name: "cat.gif", mimetype: "image/gif", size: 1234, staged: STAGED }]);
  });

  it("refuses paths that aren't the member's own, files that aren't in storage, and too many", async () => {
    bucket();
    const bad = { error: expect.stringContaining("can't be sent") };
    await expect(sendChatMessage(CHANNEL, "hi", undefined, [{ ...upload, path: STAGED.replace(MEMBER_ID, "member-gale") }])).resolves.toMatchObject({ ok: false, ...bad });

    bucket([]);
    await expect(sendChatMessage(CHANNEL, "hi", undefined, [upload])).resolves.toMatchObject({ ok: false, ...bad });

    bucket([{ name: "cat.gif", metadata: { size: 99 * 1024 * 1024 } }]);
    await expect(sendChatMessage(CHANNEL, "hi", undefined, [upload])).resolves.toMatchObject({ ok: false, ...bad });

    await expect(sendChatMessage(CHANNEL, "hi", undefined, Array.from({ length: 11 }, () => upload))).resolves.toMatchObject({ ok: false, ...bad });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("toggleChatReaction", () => {
  it("answers as soon as the Hub reaction is saved, and syncs it to Slack after the response", async () => {
    m.rpc.mockResolvedValue({ data: true, error: null });

    await expect(toggleChatReaction(MESSAGE, "tada")).resolves.toEqual({ ok: true, active: true });
    expect(m.syncReaction).not.toHaveBeenCalled();

    await flushAfter();
    expect(m.syncReaction).toHaveBeenCalledWith({ service: true }, { messageId: MESSAGE, memberId: "member-fern", emoji: "tada", active: true });
  });

  it("doesn't sync a reaction the database refused", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "chat_react: no_message" } });
    await expect(toggleChatReaction(MESSAGE, "tada")).resolves.toEqual({ ok: false, error: "That message isn't available." });
    expect(m.afterCallbacks).toHaveLength(0);
  });

  it("refuses a reaction, saving nothing, when the member has no working Slack connection: it could only stay in the Hub", async () => {
    m.connected.mockResolvedValue({ connected: false });

    await expect(toggleChatReaction(MESSAGE, "tada")).resolves.toEqual({
      ok: false,
      error: "Connect Slack in Settings to react: your reactions are sent as you.",
    });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.afterCallbacks).toHaveLength(0);
  });

  it("takes back a reaction made in Slack for a member who has connected Slack, and removes it in Slack", async () => {
    m.slackReactionRows = [{ id: "r1" }];
    m.rpc.mockResolvedValue({ data: false, error: null });

    await expect(toggleChatReaction(MESSAGE, "tada")).resolves.toEqual({ ok: true, active: false });
    await flushAfter();
    expect(m.syncReaction).toHaveBeenCalledWith({ service: true }, expect.objectContaining({ emoji: "tada", active: false }));
  });
});

describe("editChatMessage", () => {
  it("changes the message in Slack first and then in the Hub, with the trimmed text", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });

    await expect(editChatMessage(MESSAGE, "  fixed it \n")).resolves.toEqual({ ok: true });

    expect(m.slackUpdate).toHaveBeenCalledWith({ service: true }, { messageId: MESSAGE, memberId: "member-fern", body: "fixed it" });
    expect(m.rpc).toHaveBeenCalledWith("chat_edit_message", { p_message_id: MESSAGE, p_body: "fixed it" });
    expect(m.slackUpdate.mock.invocationCallOrder[0]).toBeLessThan(m.rpc.mock.invocationCallOrder[0]);
  });

  it("leaves the Hub alone when Slack refuses, and says why", async () => {
    m.slackUpdate.mockResolvedValue({ ok: false, error: "Reconnect Slack in Settings to edit this message: it was posted as you." });
    await expect(editChatMessage(MESSAGE, "new")).resolves.toEqual({ ok: false, error: expect.stringContaining("Reconnect Slack") });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses an empty or over-long edit before bothering Slack", async () => {
    await expect(editChatMessage(MESSAGE, " \n ")).resolves.toEqual({ ok: false, error: "Write something first." });
    await expect(editChatMessage(MESSAGE, "x".repeat(4001))).resolves.toMatchObject({ ok: false, error: expect.stringContaining("too long") });
    expect(m.slackUpdate).not.toHaveBeenCalled();
  });

  it("explains what the database refused", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "chat_edit: archived" } });
    await expect(editChatMessage(MESSAGE, "new")).resolves.toEqual({ ok: false, error: "This conversation is archived." });
  });

  it("is closed without the chat_posting preview, in sudo, and for a bad id", async () => {
    await expect(editChatMessage("nope", "new")).resolves.toMatchObject({ ok: false });
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_posting");
    await expect(editChatMessage(MESSAGE, "new")).resolves.toMatchObject({ ok: false });
    m.hasFeature.mockResolvedValue(true);
    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: true });
    await expect(editChatMessage(MESSAGE, "new")).resolves.toMatchObject({ ok: false });
    expect(m.slackUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteChatMessage", () => {
  it("deletes in Slack first and then in the Hub", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });

    await expect(deleteChatMessage(MESSAGE)).resolves.toEqual({ ok: true });

    expect(m.slackDelete).toHaveBeenCalledWith({ service: true }, { messageId: MESSAGE, memberId: "member-fern" });
    expect(m.rpc).toHaveBeenCalledWith("chat_delete_message", { p_message_id: MESSAGE });
    expect(m.slackDelete.mock.invocationCallOrder[0]).toBeLessThan(m.rpc.mock.invocationCallOrder[0]);
  });

  it("leaves the message in the Hub when Slack won't delete it", async () => {
    m.slackDelete.mockResolvedValue({ ok: false, error: "Slack won't let this message be deleted." });
    await expect(deleteChatMessage(MESSAGE)).resolves.toEqual({ ok: false, error: "Slack won't let this message be deleted." });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("is closed without the chat_posting preview and for a bad id", async () => {
    await expect(deleteChatMessage("nope")).resolves.toMatchObject({ ok: false });
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_posting");
    await expect(deleteChatMessage(MESSAGE)).resolves.toMatchObject({ ok: false });
    expect(m.slackDelete).not.toHaveBeenCalled();
  });
});

describe("deleteChatFile", () => {
  it("deletes the file in Slack first and then in the Hub", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    await expect(deleteChatFile(MESSAGE, "F1")).resolves.toEqual({ ok: true });
    expect(m.slackFileDelete).toHaveBeenCalledWith({ service: true }, { messageId: MESSAGE, memberId: "member-fern", fileId: "F1" });
    expect(m.rpc).toHaveBeenCalledWith("chat_delete_file", { p_message_id: MESSAGE, p_file_id: "F1" });
    expect(m.removeBytes).toHaveBeenCalledWith({ service: true }, "F1");
  });

  it("leaves the Hub alone when Slack refuses, and rejects bad ids, pending files and no access", async () => {
    m.slackFileDelete.mockResolvedValue({ ok: false, error: "nope" });
    await expect(deleteChatFile(MESSAGE, "F1")).resolves.toEqual({ ok: false, error: "nope" });
    expect(m.rpc).not.toHaveBeenCalled();
    await expect(deleteChatFile("bad", "F1")).resolves.toMatchObject({ ok: false });
    await expect(deleteChatFile(MESSAGE, "pending-1")).resolves.toMatchObject({ ok: false });
    m.getCurrentUser.mockResolvedValue(null);
    await expect(deleteChatFile(MESSAGE, "F1")).resolves.toMatchObject({ ok: false });
  });

  it("reports the database's refusal and keeps the bytes", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "chat_delete: not_yours" } });
    await expect(deleteChatFile(MESSAGE, "F1")).resolves.toMatchObject({ ok: false });
    expect(m.removeBytes).not.toHaveBeenCalled();
    expect(m.removeBytes).not.toHaveBeenCalled();
  });
});
