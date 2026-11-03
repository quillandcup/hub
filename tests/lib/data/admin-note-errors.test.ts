import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseAdminNoteRepository } from "@/lib/data/admin-notes";

/** A client whose queries and `rpc` answer with the given result. */
function dbAnswering(answer: { data: unknown; error: { message: string } | null }): { db: Db; rpcCalls: [string, unknown][] } {
  const rpcCalls: [string, unknown][] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "eq", "is", "order", "range"]) chain[m] = () => chain;
  chain.single = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  const db = {
    from: () => chain,
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return answer;
    },
  } as unknown as Db;
  return { db, rpcCalls };
}

describe("SupabaseAdminNoteRepository", () => {
  it("edit sends the trimmed text and the window to the database function, and returns its answer", async () => {
    const yes = dbAnswering({ data: true, error: null });
    expect(await new SupabaseAdminNoteRepository(yes.db).edit("mnote_AAAAAAAAAAA1", "  fixed  ", 15)).toBe(true);
    expect(yes.rpcCalls).toEqual([["edit_member_admin_note", { p_note_id: "mnote_AAAAAAAAAAA1", p_body: "fixed", p_window_minutes: 15 }]]);
    expect(await new SupabaseAdminNoteRepository(dbAnswering({ data: false, error: null }).db).edit("mnote_AAAAAAAAAAA1", "x", 15)).toBe(false);
  });

  it("edit refuses blank text before asking the database", async () => {
    const { db, rpcCalls } = dbAnswering({ data: true, error: null });
    await expect(new SupabaseAdminNoteRepository(db).edit("mnote_AAAAAAAAAAA1", "   ", 15)).rejects.toThrow("can't be empty");
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["add", (r: SupabaseAdminNoteRepository) => r.add("mbr_AAAAAAAAAAA1", "x", null)],
    ["list", (r: SupabaseAdminNoteRepository) => r.list("mbr_AAAAAAAAAAA1")],
    ["edit", (r: SupabaseAdminNoteRepository) => r.edit("mnote_AAAAAAAAAAA1", "x", 15)],
    ["remove", (r: SupabaseAdminNoteRepository) => r.remove("mbr_AAAAAAAAAAA1", "mnote_AAAAAAAAAAA1")],
  ])("%s throws the database's error", async (_name, run) => {
    const repo = new SupabaseAdminNoteRepository(dbAnswering({ data: null, error: { message: "database is down" } }).db);
    await expect(run(repo)).rejects.toThrow("database is down");
  });
});
