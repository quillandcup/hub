import { describe, it, expect, vi, beforeEach } from "vitest";

// A chainable fake service client: each (schema, table) resolves to the rows set for it.
const tables: Record<string, unknown[]> = {};
const from = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => {
    const make = (schema: string) => ({
      from: (table: string) => {
        from(`${schema}.${table}`);
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.in = () => q;
        q.eq = () => q;
        q.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[`${schema}.${table}`] ?? [] });
        return q;
      },
    });
    return { ...make("public"), schema: (s: string) => make(s) };
  },
}));

import { withMentionNames } from "@/lib/chat/names";

beforeEach(() => {
  from.mockClear();
  for (const k of Object.keys(tables)) delete tables[k];
  tables["public.chat_slack_authors"] = [];
  tables["bronze.slack_users"] = [{ user_id: "U1", display_name: "Fern", real_name: "Fern Quillsby", name: "fern" }];
  tables["bronze.slack_channels"] = [{ channel_id: "C1", name: "hub-feedback" }];
});

describe("withMentionNames", () => {
  it("turns mentions in each description into names and leaves other fields alone", async () => {
    const rows = [
      { id: "a", description: "<@U1> hi in <#C1>" },
      { id: "b", description: "no mentions" },
      { id: "c", description: null },
    ];
    expect(await withMentionNames(rows)).toEqual([
      { id: "a", description: "@Fern hi in #hub-feedback" },
      { id: "b", description: "no mentions" },
      { id: "c", description: null },
    ]);
  });

  it("falls back to the mention's own label, then a generic word, when no name is known", async () => {
    const out = await withMentionNames([{ description: "<@U9|moss> <@U8>" }]);
    expect(out[0].description).toBe("@moss @someone");
  });

  it("does not query anything when no row mentions anyone", async () => {
    const rows = [{ description: "plain" }, { description: undefined }];
    expect(await withMentionNames(rows)).toBe(rows);
    expect(from).not.toHaveBeenCalled();
  });
});
