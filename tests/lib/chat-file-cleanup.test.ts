import { describe, it, expect, vi, beforeEach } from "vitest";
import { removeChatFileBytes, sweepDeletedFileBytes } from "@/lib/chat/file-cleanup";

type Err = { message: string } | null;
const s = {
  refs: [] as { message_id: string }[],
  refError: null as Err,
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
  from: () => ({ select: () => ({ contains: () => ({ limit: async () => ({ data: s.refs, error: s.refError }) }) }) }),
  schema: () => ({ from: bronze }),
  storage: { from: () => ({ remove: async (paths: string[]) => (s.removed.push(paths), { error: s.removeError }) }) },
} as never;

beforeEach(() => {
  Object.assign(s, { refs: [], refError: null, row: { storage_path: "F1/a.png", deleted_at: null }, rowError: null, updateError: null, removeError: null, sweepRows: [], sweepError: null, updates: [], removed: [] });
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
    s.refs = [{ message_id: "m2" }];
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
    s.refError = { message: "boom" };
    await expect(removeChatFileBytes(service, "F1")).resolves.toBe("failed");
    s.refError = null;
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
