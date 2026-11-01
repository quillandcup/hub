import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { filesGoneFromSlack, removeChatFileBytes, sweepDeletedFileBytes } from "@/lib/chat/file-cleanup";

// Which messages list a file is the chat repository's business and the files themselves are Bronze's (SlackMessageRepository):
// the in-memory twins stand in for both.
let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
/** Another message lists file F1 (a tombstone, in the ignoreReferences case). */
const listedByAnotherMessage = () => {
  dataset.chatMessageContents = [{ message_id: "msg_AAAAAAAAAAA2", files: [{ id: "F1" }] }];
};

const s = {
  removeError: null as { message: string } | null,
  removed: [] as string[][],
};
const service = {
  storage: { from: () => ({ remove: async (paths: string[]) => (s.removed.push(paths), { error: s.removeError }) }) },
} as never;

const fileRow = (extra = {}) => ({ file_id: "F1", channel_id: "C1", message_ts: "1.1", storage_path: "F1/a.png" as string | null, deleted_at: null as string | null, ...extra });
const stored = (id = "F1") => dataset.slackFiles.find((f) => f.file_id === id);

beforeEach(() => {
  Object.assign(s, { removeError: null, removed: [] });
  dataset = new InMemoryDataset({ slackFiles: [fileRow()] });
  repos = createInMemoryRepos(dataset);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("removeChatFileBytes", () => {
  it("soft-deletes the Bronze row, removes the bytes and clears the path", async () => {
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("removed");
    expect(s.removed).toEqual([["F1/a.png"]]);
    expect(stored()).toMatchObject({ copy_error: "skipped: deleted", storage_path: null, copied_at: null });
    expect(stored()?.deleted_at).toBeTruthy();
  });

  it("keeps everything while another message still lists the file", async () => {
    listedByAnotherMessage();
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("kept");
    expect(s.removed).toEqual([]);
    expect(stored()).toMatchObject({ storage_path: "F1/a.png", deleted_at: null });
  });

  it("does nothing for a file Bronze never recorded", async () => {
    dataset.slackFiles = [];
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("nothing");
  });

  it("handles a row that is already soft-deleted or never copied", async () => {
    dataset.slackFiles = [fileRow({ storage_path: null, deleted_at: "2026-01-01T00:00:00Z" })];
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("removed");
    expect(s.removed).toEqual([]);
    expect(stored()).toMatchObject({ storage_path: null, deleted_at: "2026-01-01T00:00:00Z" });
  });

  it("leaves the path set (retriable by the sweep) when the storage delete fails", async () => {
    s.removeError = { message: "boom" };
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("failed");
    expect(stored()?.storage_path).toBe("F1/a.png");
    expect(stored()?.deleted_at).toBeTruthy();
  });

  it("reports a failure to clear the path", async () => {
    const update = repos.slackMessages.updateFile.bind(repos.slackMessages);
    vi.spyOn(repos.slackMessages, "updateFile").mockImplementation(async (id, change) => {
      if ("storage_path" in change) throw new Error("boom");
      return update(id, change);
    });
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("failed");
  });

  it("never throws on lookup errors", async () => {
    vi.spyOn(repos.chat, "fileIsListed").mockRejectedValue(new Error("boom"));
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("failed");
    vi.mocked(repos.chat.fileIsListed).mockRestore();
    vi.spyOn(repos.slackMessages, "fileById").mockRejectedValue(new Error("boom"));
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("failed");
  });
});

describe("sweepDeletedFileBytes", () => {
  const deleted = (id: string) => fileRow({ file_id: id, storage_path: `${id}/x.png`, deleted_at: "2026-01-01T00:00:00Z" });

  it("retries removals and counts successes and failures", async () => {
    dataset.slackFiles = [deleted("F1"), deleted("F2")];
    await expect(sweepDeletedFileBytes(service)).resolves.toEqual({ removed: 2, failed: 0 });
    expect(stored("F1")?.storage_path).toBeNull();
    dataset.slackFiles = [deleted("F1"), deleted("F2")];
    s.removeError = { message: "boom" };
    await expect(sweepDeletedFileBytes(service)).resolves.toEqual({ removed: 0, failed: 2 });
  });

  it("reports a failed listing", async () => {
    vi.spyOn(repos.slackMessages, "deletedFilesWithBytes").mockRejectedValue(new Error("boom"));
    await expect(sweepDeletedFileBytes(service)).resolves.toEqual({ removed: 0, failed: 1 });
  });

  it("does nothing when nothing is pending", async () => {
    await expect(sweepDeletedFileBytes(service)).resolves.toEqual({ removed: 0, failed: 0 });
  });
});

describe("removeChatFileBytes for a file Slack deleted", () => {
  it("ignores message lists that still name it", async () => {
    listedByAnotherMessage();
    await expect(removeChatFileBytes(service, "F1", { ignoreReferences: true })).resolves.toBe("removed");
    expect(s.removed).toEqual([["F1/a.png"]]);
  });
});

describe("filesGoneFromSlack", () => {
  const row = (file_id: string, message_ts: string) => ({ file_id, channel_id: "C1", message_ts });
  it("finds tombstones and files dropped from a fetched message, not live or unfetched ones", () => {
    const messages = [
      { channel_id: "C1", message_ts: "1.1", files: [{ id: "T", mode: "tombstone" }] },
      { channel_id: "C1", message_ts: "2.1", files: [{ id: "LIVE" }, {}] },
      { channel_id: "C1", message_ts: "3.1", files: null },
      { channel_id: "C1", message_ts: "4.1", files: [{ id: "SHARED" }] },
    ];
    const stored = [row("T", "1.1"), row("LIVE", "2.1"), row("DROPPED", "3.1"), row("UNFETCHED", "9.1"), row("SHARED", "3.1")];
    expect(filesGoneFromSlack(messages, stored)).toEqual(["T", "DROPPED"]);
  });
});
