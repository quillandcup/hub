import { describe, it, expect, vi, beforeEach } from "vitest";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const { uploadV2, filesInfo, tokensUsed } = vi.hoisted(() => ({ uploadV2: vi.fn(), filesInfo: vi.fn(), tokensUsed: [] as (string | undefined)[] }));
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function (token?: string) {
    tokensUsed.push(token);
    return { filesUploadV2: (args: unknown) => uploadV2(args, token), files: { info: (args: unknown) => filesInfo(args, token) } };
  }),
}));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { lookupFileMessageTs, sendChatFilesToSlack, uploadedFileIds, type FileSendContext } from "@/lib/chat/slack-upload";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

let storedBytes: Record<string, string>;
let removed: string[][];
let dataset: InMemoryDataset;
let bronzeRows: unknown[];
const rpc = vi.fn(async (_n: string, _a: unknown) => ({ error: null }));
const fail = vi.fn(async (_reason: string) => "failed" as const);

const supabase = {
  rpc,
  storage: {
    from: () => ({
      download: async (path: string) => (path in storedBytes ? { data: new Blob([storedBytes[path]]), error: null } : { data: null, error: { message: "not found" } }),
      upload: async (path: string) => {
        storedBytes[`uploaded:${path}`] = "x";
        return { error: null };
      },
      remove: async (paths: string[]) => {
        removed.push(paths);
        return { error: null };
      },
    }),
  },
  schema: () => ({ from: () => ({ upsert: async (row: unknown) => (bronzeRows.push(row), { error: null }) }) }),
};

const FILES = [
  { id: "pending-1", name: "cat.gif", mimetype: "image/gif", size: 3, width: null, height: null, staged: "staging/2026-10-22/m-1/cat.gif" },
  { id: "pending-2", name: "notes.pdf", mimetype: "application/pdf", size: 3, width: null, height: null, staged: "staging/2026-10-22/m-1/notes.pdf" },
];
const ctx = (extra: Partial<FileSendContext> = {}): FileSendContext => ({
  supabase: supabase as never,
  messageId: "m1",
  slackChannelId: "C1",
  threadTs: undefined,
  body: "look <here>",
  files: FILES.map((f) => ({ ...f })),
  connection: { token: "xoxp-member" },
  authorMemberId: "member-fern",
  escape: (t) => t.replace(/</g, "&lt;"),
  fail,
  ...extra,
});

beforeEach(() => {
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
  storedBytes = { "staging/2026-10-22/m-1/cat.gif": "gif", "staging/2026-10-22/m-1/notes.pdf": "pdf" };
  removed = [];
  dataset = new InMemoryDataset({ chatMessages: [{ id: "m1", channel_id: "chn_AAAAAAAAAAA1" }], chatMessageContents: [{ message_id: "m1", files: [] }] });
  repos = createInMemoryRepos(dataset);
  bronzeRows = [];
  tokensUsed.length = 0;
  rpc.mockClear();
  fail.mockClear();
  uploadV2.mockReset();
  uploadV2.mockResolvedValue({ ok: true, files: [{ files: [{ id: "F1" }] }, { files: [{ id: "F2" }] }] });
  filesInfo.mockReset();
  filesInfo.mockResolvedValue({ file: { shares: { private: { C1: [{ ts: "1700000000.000200" }] } } } });
});

describe("uploadedFileIds", () => {
  it("reads ids from v2's nested results, in order, and tolerates other shapes", () => {
    expect(uploadedFileIds({ files: [{ files: [{ id: "A" }] }, { id: "B" }, { files: [{ id: "C" }, {}] }] })).toEqual(["A", "B", "C"]);
    expect(uploadedFileIds(null)).toEqual([]);
  });
});

describe("lookupFileMessageTs", () => {
  useFakeClock();

  it("finds the ts from the file's shares, waiting while Slack hasn't shared it yet", async () => {
    filesInfo.mockResolvedValueOnce({ file: { shares: {} } }).mockResolvedValueOnce({ file: { shares: { public: { C1: [{ ts: "9.9" }] } } } });
    expect(await lookupFileMessageTs("xoxb-test", "F1", "C1")).toBe("9.9");
    expect(filesInfo).toHaveBeenCalledTimes(2);
  });

  it("gives up after a few tries", async () => {
    filesInfo.mockResolvedValue({ file: { shares: {} } });
    expect(await lookupFileMessageTs("xoxb-test", "F1", "C1")).toBeNull();
    expect(filesInfo).toHaveBeenCalledTimes(4);
  });
});

describe("sendChatFilesToSlack", () => {
  useFakeClock();

  it("uploads the staged bytes as the member, stores the real ids, marks it sent and keeps permanent copies", async () => {
    const result = await sendChatFilesToSlack(ctx({ threadTs: "1.1" }));

    expect(result).toBe("sent");
    expect(uploadV2).toHaveBeenCalledTimes(1);
    const [args, token] = uploadV2.mock.calls[0];
    expect(token).toBe("xoxp-member");
    expect(args).toMatchObject({ channel_id: "C1", thread_ts: "1.1", initial_comment: "look &lt;here>" });
    expect(args.file_uploads.map((u: { filename: string }) => u.filename)).toEqual(["cat.gif", "notes.pdf"]);
    expect(dataset.chatMessageContents[0].files).toEqual([
      { id: "F1", name: "cat.gif", mimetype: "image/gif", size: 3, width: null, height: null },
      { id: "F2", name: "notes.pdf", mimetype: "application/pdf", size: 3, width: null, height: null },
    ]);
    expect(rpc).toHaveBeenCalledWith("chat_mark_message_sent", { p_message_id: "m1", p_slack_ts: "1700000000.000200" });
    expect(dataset.chatMessages[0].posted_via).toBe("user_token");
    expect(Object.keys(storedBytes).filter((k) => k.startsWith("uploaded:"))).toEqual(["uploaded:F1/cat.gif", "uploaded:F2/notes.pdf"]);
    expect(bronzeRows).toHaveLength(2);
    expect(removed).toEqual([["staging/2026-10-22/m-1/cat.gif", "staging/2026-10-22/m-1/notes.pdf"]]);
  });

  it("never uploads through the bot: without a working connection the message fails and waits for a Retry", async () => {
    expect(await sendChatFilesToSlack(ctx({ connection: null }))).toBe("failed");
    expect(uploadV2).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(expect.stringContaining("no working Slack connection"));
  });

  it.each([
    ["token_revoked", "a dead token"],
    ["missing_scope", "a connection from before the Hub uploaded files for members"],
  ])("revokes the connection on %s (%s) so the member reconnects, and fails instead of falling back to the bot", async (code) => {
    uploadV2.mockRejectedValueOnce(Object.assign(new Error("x"), { data: { error: code } }));
    expect(await sendChatFilesToSlack(ctx())).toBe("failed");
    expect(uploadV2).toHaveBeenCalledTimes(1);
    expect(uploadV2.mock.calls[0][1]).toBe("xoxp-member");
    expect(rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-fern" });
  });

  it("fails without uploading when a staged copy is gone, and on any other member-token error", async () => {
    delete storedBytes["staging/2026-10-22/m-1/notes.pdf"];
    expect(await sendChatFilesToSlack(ctx())).toBe("failed");
    expect(uploadV2).not.toHaveBeenCalled();

    storedBytes["staging/2026-10-22/m-1/notes.pdf"] = "pdf";
    uploadV2.mockRejectedValueOnce(Object.assign(new Error("x"), { data: { error: "ratelimited" } }));
    expect(await sendChatFilesToSlack(ctx({ connection: { token: "xoxp-member" } }))).toBe("failed");
    expect(uploadV2).toHaveBeenCalledTimes(1);
  });

  it("fails when Slack returns a different number of files", async () => {
    uploadV2.mockResolvedValue({ files: [{ files: [{ id: "F1" }] }] });
    expect(await sendChatFilesToSlack(ctx())).toBe("failed");
    expect(dataset.chatMessageContents[0].files).toEqual([]);
  });

  it("carries on when storing the real file ids or the posted-via marker fails, logging the first", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.chat, "setMessageFiles").mockRejectedValue(new Error("store boom"));
    vi.spyOn(repos.chat, "setPostedVia").mockRejectedValue(new Error("via boom"));

    expect(await sendChatFilesToSlack(ctx())).toBe("sent");
    expect(log).toHaveBeenCalledWith(expect.any(String), "m1", "store boom");
    expect(rpc).toHaveBeenCalledWith("chat_mark_message_sent", { p_message_id: "m1", p_slack_ts: "1700000000.000200" });
    log.mockRestore();
  });

  it("leaves the message pending, without uploading again, when Slack hasn't shared the files yet or on a retry", async () => {
    filesInfo.mockResolvedValue({ file: { shares: {} } });
    const first = ctx();
    expect(await sendChatFilesToSlack(first)).toBe("sent");
    expect(rpc).not.toHaveBeenCalledWith("chat_mark_message_sent", expect.anything());

    // The retry: ids are real now, so nothing is uploaded; it only looks for the ts again.
    uploadV2.mockClear();
    filesInfo.mockResolvedValue({ file: { shares: { private: { C1: [{ ts: "5.5" }] } } } });
    expect(await sendChatFilesToSlack(ctx({ files: first.files }))).toBe("sent");
    expect(uploadV2).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("chat_mark_message_sent", { p_message_id: "m1", p_slack_ts: "5.5" });
  });
});
