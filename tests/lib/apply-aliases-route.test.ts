import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase } from "@/tests/helpers/server-page";

// POST /api/admin/apply-aliases reads supabase/member-aliases.csv (email,alias per line). Each name
// is checked like any other new alias (lib/name-alias-conflict.ts) before it is created.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

let fake = createFakeSupabase();
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, supabase: fake }),
}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ rpc: rpcMock }) }));

const triggerReprocessingMock = vi.fn();
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: (...args: unknown[]) => triggerReprocessingMock(...args) }));

let csv: string | null = null;
vi.mock("fs", () => ({
  default: {
    existsSync: () => csv !== null,
    readFileSync: () => csv,
  },
}));

import { POST } from "@/app/api/admin/apply-aliases/route";

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", status: "active", kajabiId: null, stripeCustomerId: null };

const post = () => POST(new NextRequest("http://localhost/api/admin/apply-aliases", { method: "POST" }));
const inserts = () => dataset.nameAliases;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeSupabase();
  dataset = new InMemoryDataset({ members: [ADA] });
  repos = createInMemoryRepos(dataset);
  rpcMock.mockResolvedValue({ data: [], error: null });
  triggerReprocessingMock.mockResolvedValue({ processed: [] });
  csv = "email,alias\nada@example.test,Ada E\n";
});

describe("POST /api/admin/apply-aliases", () => {
  it("404s without the file", async () => {
    csv = null;
    expect((await post()).status).toBe(404);
  });

  it("creates a free alias and reprocesses", async () => {
    const body = await (await post()).json();

    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: ADA.id, p_alias: "Ada E" });
    expect(body).toMatchObject({ created: 1, skipped: 0, errors: 0 });
    expect(inserts()).toHaveLength(1);
    expect(triggerReprocessingMock).toHaveBeenCalled();
  });

  it("counts a name someone else grabbed since the check as an error", async () => {
    dataset.nameAliases.push({ id: "nal_x", member_id: "mbr_AAAAAAAAAAA2", alias: "Ada E", source: "zoom", active: true });

    const body = await (await post()).json();

    expect(body).toMatchObject({ created: 0, errors: 1 });
    expect(body.messages[0]).toContain('Error creating alias "Ada E"');
  });

  it("counts an alias the store can't save as an error", async () => {
    vi.spyOn(repos.aliases, "addName").mockRejectedValue(new Error("db down"));

    const body = await (await post()).json();

    expect(body).toMatchObject({ created: 0, errors: 1 });
    expect(body.messages[0]).toContain("db down");
  });

  it.each(["own", "own_inactive"])("skips a name the member already has (%s)", async (kind) => {
    rpcMock.mockResolvedValue({ data: [{ kind, other_member_id: null, other_member_name: null }], error: null });

    const body = await (await post()).json();

    expect(body).toMatchObject({ created: 0, skipped: 1, errors: 0 });
    expect(body.messages[0]).toContain("Alias already exists");
    expect(inserts()).toHaveLength(0);
  });

  it("refuses a name that is another member's, saying whose, and doesn't reprocess", async () => {
    rpcMock.mockResolvedValue({ data: [{ kind: "other_alias", other_member_id: "mbr_AAAAAAAAAAA2", other_member_name: "Fern Example" }], error: null });

    const body = await (await post()).json();

    expect(body).toMatchObject({ created: 0, errors: 1 });
    expect(body.messages[0]).toContain("already an alias for Fern Example");
    expect(inserts()).toHaveLength(0);
    expect(triggerReprocessingMock).not.toHaveBeenCalled();
  });

  it("counts a failed check as an error and moves on", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "rpc down" } });

    const body = await (await post()).json();

    expect(body).toMatchObject({ created: 0, errors: 1 });
    expect(body.messages[0]).toContain("rpc down");
    expect(inserts()).toHaveLength(0);
  });
});
