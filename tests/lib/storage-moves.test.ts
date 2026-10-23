import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { moveQueuedObjects } from "@/lib/storage-moves";

type Row = { bucket: string; old_path: string; new_path: string };

function fake(rows: Row[], opts: { missing?: string[]; alreadyAt?: string[] } = {}) {
  const queue = [...rows];
  const moves: string[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe("storage_path_moves");
      return {
        select: async () => ({ data: [...queue], error: null }),
        delete: () => {
          const f: Record<string, string> = {};
          const chain = {
            eq: (col: string, val: string) => {
              f[col] = val;
              if (f.bucket !== undefined && f.old_path !== undefined) {
                const i = queue.findIndex((r) => r.bucket === f.bucket && r.old_path === f.old_path);
                if (i >= 0) queue.splice(i, 1);
                return Promise.resolve({ error: null });
              }
              return chain;
            },
          };
          return chain;
        },
      };
    },
    storage: {
      from: (bucket: string) => ({
        move: async (from: string, to: string) => {
          if (opts.missing?.includes(from)) return { error: { message: "not found" } };
          moves.push(`${bucket}:${from}->${to}`);
          return { error: null };
        },
        exists: async (path: string) => ({ data: Boolean(opts.alreadyAt?.includes(path)), error: null }),
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, queue, moves };
}

const rows: Row[] = [
  { bucket: "book-covers", old_path: "old/a.jpg", new_path: "mbr_x/a.jpg" },
  { bucket: "event-photos", old_path: "olde/p", new_path: "evt_y/p" },
];

describe("moveQueuedObjects", () => {
  it("moves each object and empties the queue", async () => {
    const { client, queue, moves } = fake(rows);
    expect(await moveQueuedObjects(client)).toEqual({ moved: 2, alreadyThere: 0, failed: [] });
    expect(moves).toEqual(["book-covers:old/a.jpg->mbr_x/a.jpg", "event-photos:olde/p->evt_y/p"]);
    expect(queue).toEqual([]);
  });

  it("counts an object already at the new path as done", async () => {
    const { client, queue } = fake(rows, { missing: ["old/a.jpg"], alreadyAt: ["mbr_x/a.jpg"] });
    const result = await moveQueuedObjects(client);
    expect(result).toMatchObject({ moved: 1, alreadyThere: 1, failed: [] });
    expect(queue).toEqual([]);
  });

  it("keeps the row and reports an object that is nowhere", async () => {
    const { client, queue } = fake(rows, { missing: ["olde/p"] });
    const result = await moveQueuedObjects(client);
    expect(result.moved).toBe(1);
    expect(result.failed).toEqual([{ bucket: "event-photos", oldPath: "olde/p", error: "not found" }]);
    expect(queue).toEqual([rows[1]]);
  });
});
