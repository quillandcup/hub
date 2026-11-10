import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { describeOwnedRows } from "@/lib/member-merge-coverage";

const auth = vi.hoisted(() => ({ current: { user: { id: "admin" }, supabase: {} } as { user: { id: string } | null; forbidden?: boolean; supabase: object } }));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: async () => auth.current }));

const state = vi.hoisted(() => ({ repos: null as unknown }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => state.repos,
}));

import { GET } from "@/app/api/admin/members/[id]/owned-data/route";

const ADA = "mbr_AAAAAAAAAAA1";
const ada = { id: ADA, name: "Ada Example", email: "ada@example.com" };

function call(id: string) {
  return GET(new NextRequest(`http://localhost/api/admin/members/${id}/owned-data`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  auth.current = { user: { id: "admin" }, supabase: {} };
  state.repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [ada],
      nameAliases: [{ id: "nal_1", member_id: ADA, alias: "Penny Quill", source: "zoom", active: true }],
    } as never),
  );
});

describe("GET /api/admin/members/[id]/owned-data", () => {
  it("lists the member's rows with what a merge does with them", async () => {
    const res = await call(ADA);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [{ table: "member_name_aliases", label: "Name aliases", count: 1, fate: "moved" }] });
  });

  it("answers an empty list for a member who owns nothing", async () => {
    state.repos = createInMemoryRepos(new InMemoryDataset({ members: [ada] } as never));

    expect(await (await call(ADA)).json()).toEqual({ entries: [] });
  });

  it("is 401 signed out and 403 for a non-admin", async () => {
    auth.current = { user: null, supabase: {} };
    expect((await call(ADA)).status).toBe(401);
    auth.current = { user: { id: "u" }, forbidden: true, supabase: {} };
    expect((await call(ADA)).status).toBe(403);
  });

  it("is 400 for an id that is not a member id and 404 for a member that does not exist", async () => {
    expect((await call("not-an-id")).status).toBe(400);
    expect((await call("mbr_AAAAAAAAAAA2")).status).toBe(404);
  });

  it("is 500 when the count fails", async () => {
    const repos = state.repos as { members: { ownedRowCounts: () => Promise<never> } };
    repos.members.ownedRowCounts = async () => {
      throw new Error("down");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await call(ADA)).status).toBe(500);
  });
});

describe("describeOwnedRows", () => {
  it("puts lost rows first, drops derived stats and empty tables, and falls back to the table name", () => {
    expect(
      describeOwnedRows([
        { table: "member_badges", count: 2 },
        { table: "member_metrics", count: 1 },
        { table: "writing_projects", count: 3 },
        { table: "brand_new_table", count: 1 },
        { table: "member_books", count: 0 },
      ]),
    ).toEqual([
      { table: "brand_new_table", label: "brand_new_table", count: 1, fate: "lost" },
      { table: "writing_projects", label: "Writing projects", count: 3, fate: "lost" },
      { table: "member_badges", label: "Badges", count: 2, fate: "moved" },
    ]);
  });
});
