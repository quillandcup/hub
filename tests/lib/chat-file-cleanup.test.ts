import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { filesGoneFromSlack, removeChatFileBytes, sweepDeletedFileBytes } from "@/lib/chat/file-cleanup";

// Which messages list a file is the chat repository's business: the in-memory twin stands in for it.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
/** Another message lists file F1 (a tombstone, in the ignoreReferences case). */
const listedByAnotherMessage = () => {
  repos = createInMemoryRepos(new InMemoryDataset({ chatMessageContents: [{ message_id: "msg_AAAAAAAAAAA2", files: [{ id: "F1" }] }] }));
};

type Err = { message: string } | null;
const s = {
  row: null as { storage_path: string | null; deleted_at: string | null } | null,
  rowError: null as Err,
  updateError: null as Err,
  removeError: null as Err,
  sweepRows: [] as { file_id: string; storage_path: string }[],
  sweepError: null as Err,
  updates: [] as Record<string, unknown>[],
  removed: [] as string[][],
};

const bronze = () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.not = () => chain;
  chain.order = () => chain;
  chain.limit = async () => ({ data: s.sweepRows, error: s.sweepError });
  chain.maybeSingle = async () => ({ data: s.row, error: s.rowError });
  chain.update = (fields: Record<string, unknown>) => {
    s.updates.push(fields);
    return { eq: async () => ({ error: "storage_path" in fields ? s.updateError : null }) };
  };
  return chain;
};
const service = {
  schema: () => ({ from: bronze }),
  storage: { from: () => ({ remove: async (paths: string[]) => (s.removed.push(paths), { error: s.removeError }) }) },
} as never;

beforeEach(() => {
  Object.assign(s, { row: { storage_path: "F1/a.png", deleted_at: null }, rowError: null, updateError: null, removeError: null, sweepRows: [], sweepError: null, updates: [], removed: [] });
  repos = createInMemoryRepos();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("removeChatFileBytes", () => {
  it("soft-deletes the Bronze row, removes the bytes and clears the path", async () => {
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("removed");
    expect(s.removed).toEqual([["F1/a.png"]]);
    expect(s.updates[0]).toMatchObject({ copy_error: "skipped: deleted" });
    expect(s.updates[0].deleted_at).toBeTruthy();
    expect(s.updates[1]).toEqual({ storage_path: null, copied_at: null });
  });

  it("keeps everything while another message still lists the file", async () => {
    listedByAnotherMessage();
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("kept");
    expect(s.removed).toEqual([]);
    expect(s.updates).toEqual([]);
  });

  it("does nothing for a file Bronze never recorded", async () => {
    s.row = null;
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("nothing");
  });

  it("handles a row that is already soft-deleted or never copied", async () => {
    s.row = { storage_path: null, deleted_at: "2026-01-01T00:00:00Z" };
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("removed");
    expect(s.removed).toEqual([]);
    expect(s.updates).toEqual([{ storage_path: null, copied_at: null }]);
  });

  it("leaves the path set (retriable by the sweep) when the storage delete fails", async () => {
    s.removeError = { message: "boom" };
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("failed");
    expect(s.updates).toHaveLength(1);
    expect(s.updates[0]).not.toHaveProperty("storage_path");
  });

  it("reports a failure to clear the path", async () => {
    s.updateError = { message: "boom" };
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("failed");
  });

  it("never throws on lookup errors", async () => {
    vi.spyOn(repos.chat, "fileIsListed").mockRejectedValue(new Error("boom"));
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("failed");
    vi.mocked(repos.chat.fileIsListed).mockRestore();
    s.rowError = { message: "boom" };
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("failed");
  });
});

describe("sweepDeletedFileBytes", () => {
  it("retries removals and counts successes and failures", async () => {
    s.sweepRows = [{ file_id: "F1", storage_path: "F1/a.png" }, { file_id: "F2", storage_path: "F2/b.png" }];
    await expect(sweepDeletedFileBytes(service)).resolves.toEqual({ removed: 2, failed: 0 });
    s.removeError = { message: "boom" };
    await expect(sweepDeletedFileBytes(service)).resolves.toEqual({ removed: 0, failed: 2 });
  });

  it("reports a failed listing", async () => {
    s.sweepError = { message: "boom" };
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
