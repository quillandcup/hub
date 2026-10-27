import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

// The admin routes that create name aliases (the names attendance is matched by) refuse a name that
// belongs to another member (lib/name-alias-conflict.ts) instead of taking it over.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

let tables: FakeTables = {};
let fake = createFakeSupabase();
let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, supabase: fake } : { user: null }),
}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ rpc: rpcMock }) }));

const triggerReprocessingMock = vi.fn();
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: (...args: unknown[]) => triggerReprocessingMock(...args) }));

const updateContactMock = vi.fn();
vi.mock("@/lib/kajabi/client", () => ({ createKajabiClient: () => ({ updateContact: updateContactMock }) }));

import { POST as saveAliases } from "@/app/api/aliases/route";
import { POST as resolveAmbiguous } from "@/app/api/zoom/resolve-ambiguous/route";
import { PATCH as patchMember } from "@/app/api/admin/members/[id]/route";

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", status: "active", kajabiId: "kaj-ada", stripeCustomerId: null };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "fern@example.test", status: "active", kajabiId: null, stripeCustomerId: null };

const conflictRow = (kind: string, name: string | null = "Fern Example") => ({
  data: [{ kind, other_member_id: name ? FERN.id : null, other_member_name: name }],
  error: null,
});

/** Calls recorded against one table, to check what was (not) written. */
function writes(table: string, method: string) {
  return fake.queries.filter((q) => q.table === table && q.calls.some((c) => c.method === method));
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn = true;
  tables = {};
  fake = createFakeSupabase(tables);
  rpcMock.mockResolvedValue({ data: [], error: null });
  dataset = new InMemoryDataset({ members: [ADA, FERN] });
  repos = createInMemoryRepos(dataset);
});

describe("POST /api/aliases", () => {
  const post = (body: unknown) => saveAliases(new NextRequest("http://localhost/api/aliases", { method: "POST", body: JSON.stringify(body) }));

  it("checks each name for its member, then saves them all", async () => {
    tables["member_name_aliases"] = { data: [{ id: "a1" }, { id: "a2" }] };
    fake = createFakeSupabase(tables);

    const res = await post({ matches: [{ memberId: ADA.id, zoomName: "Ada E" }, { memberId: FERN.id, zoomName: "Fern E" }] });

    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: ADA.id, p_alias: "Ada E" });
    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: FERN.id, p_alias: "Fern E" });
    expect(writes("member_name_aliases", "insert")).toHaveLength(1);
  });

  it("saves nothing when any name is taken, and says whose it is", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce(conflictRow("other_alias"));

    const res = await post({ matches: [{ memberId: ADA.id, zoomName: "Ada E" }, { memberId: ADA.id, zoomName: "Fern E" }] });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(`"Fern E" is already an alias for Fern Example. Move it from there first.`);
    expect(writes("member_name_aliases", "insert")).toHaveLength(0);
    expect(triggerReprocessingMock).not.toHaveBeenCalled();
  });

  it("refuses another member's real name", async () => {
    rpcMock.mockResolvedValue(conflictRow("other_name"));
    const res = await post({ matches: [{ memberId: ADA.id, zoomName: "Fern Example" }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Fern Example's real name");
  });

  it("refuses a name the member already has", async () => {
    rpcMock.mockResolvedValue(conflictRow("own", null));
    const res = await post({ matches: [{ memberId: ADA.id, zoomName: "Ada E" }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already one of this member's names");
  });

  it("reports a failed check instead of saving", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "rpc down" } });
    const res = await post({ matches: [{ memberId: ADA.id, zoomName: "Ada E" }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("rpc down");
    expect(writes("member_name_aliases", "insert")).toHaveLength(0);
  });
});

describe("POST /api/zoom/resolve-ambiguous", () => {
  const post = (body: unknown) =>
    resolveAmbiguous(new NextRequest("http://localhost/api/zoom/resolve-ambiguous", { method: "POST", body: JSON.stringify(body) }));

  it("adds the alias and resolves the name when it is free", async () => {
    const res = await post({ zoomName: "Katie", memberId: ADA.id });

    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: ADA.id, p_alias: "Katie" });
    expect(writes("member_name_aliases", "upsert")).toHaveLength(1);
    expect(writes("ambiguous_zoom_names", "update")).toHaveLength(1);
    expect(triggerReprocessingMock).toHaveBeenCalledWith("member_name_aliases", "local");
  });

  it("doesn't take the name from another member", async () => {
    rpcMock.mockResolvedValue(conflictRow("other_alias"));

    const res = await post({ zoomName: "Katie", memberId: ADA.id });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already an alias for Fern Example");
    expect(writes("member_name_aliases", "upsert")).toHaveLength(0);
    expect(writes("ambiguous_zoom_names", "update")).toHaveLength(0);
  });

  it("doesn't shadow another member's real name", async () => {
    rpcMock.mockResolvedValue(conflictRow("other_name"));
    expect((await post({ zoomName: "Fern Example", memberId: ADA.id })).status).toBe(409);
    expect(writes("member_name_aliases", "upsert")).toHaveLength(0);
  });

  it("just resolves when the member already has that name switched on", async () => {
    rpcMock.mockResolvedValue(conflictRow("own", null));

    const res = await post({ zoomName: "Katie", memberId: ADA.id });

    expect(res.status).toBe(200);
    expect(writes("member_name_aliases", "upsert")).toHaveLength(0);
    expect(writes("ambiguous_zoom_names", "update")).toHaveLength(1);
  });

  it("asks the admin to switch it back on when the member has it switched off", async () => {
    rpcMock.mockResolvedValue(conflictRow("own_inactive", null));
    const res = await post({ zoomName: "Katie", memberId: ADA.id });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("switched off");
  });

  it("reports a failed check", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "rpc down" } });
    const res = await post({ zoomName: "Katie", memberId: ADA.id });
    expect(res.status).toBe(500);
    expect(writes("member_name_aliases", "upsert")).toHaveLength(0);
  });

  it("ignoring a name doesn't run the check", async () => {
    expect((await post({ zoomName: "Katie", action: "ignore" })).status).toBe(200);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/members/[id]", () => {
  const patch = (id: string, body: unknown) =>
    patchMember(new NextRequest(`http://localhost/api/admin/members/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });

  it("adds a new pen name that is free", async () => {
    const res = await patch(ADA.id, { newPenName: " Ada E " });

    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: ADA.id, p_alias: "Ada E" });
    expect(dataset.nameAliases.map((a) => [a.member_id, a.alias, a.source])).toEqual([[ADA.id, "Ada E", "admin"]]);
  });

  it("refuses a new pen name that is another member's, saying whose", async () => {
    rpcMock.mockResolvedValue(conflictRow("other_alias"));

    const res = await patch(ADA.id, { newPenName: "Fern E" });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already an alias for Fern Example");
    expect(dataset.nameAliases).toEqual([]);
  });

  it("refuses a new pen name when the check fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "rpc down" } });
    const res = await patch(ADA.id, { newPenName: "Ada E" });
    expect(res.status).toBe(500);
    expect(dataset.nameAliases).toEqual([]);
  });

  it("won't rename (or touch Kajabi) when keeping the old name would take it from someone else", async () => {
    rpcMock.mockResolvedValue(conflictRow("other_alias"));

    const res = await patch(ADA.id, { name: "Ada Newname", keepOldNameAsPenName: true });

    expect(res.status).toBe(409);
    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: ADA.id, p_alias: "Ada Example" });
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(writes("members", "update")).toHaveLength(0);
    expect(dataset.nameAliases).toEqual([]);
  });

  it("renames and keeps the old name when it is free", async () => {
    const res = await patch(ADA.id, { name: "Ada Newname", keepOldNameAsPenName: true });

    expect(res.status).toBe(200);
    expect(updateContactMock).toHaveBeenCalled();
    expect(dataset.nameAliases.map((a) => [a.member_id, a.alias, a.source])).toEqual([[ADA.id, "Ada Example", "admin"]]);
    expect(await repos.members.byId(ADA.id)).toMatchObject({ name: "Ada Newname", displayName: "Ada Example" });
  });

  it("renames when the old name is already one of the member's own", async () => {
    rpcMock.mockResolvedValue(conflictRow("own", null));
    expect((await patch(ADA.id, { name: "Ada Newname", keepOldNameAsPenName: true })).status).toBe(200);
  });

  it("reports a failed check before renaming", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "rpc down" } });
    const res = await patch(ADA.id, { name: "Ada Newname", keepOldNameAsPenName: true });
    expect(res.status).toBe(500);
    expect(updateContactMock).not.toHaveBeenCalled();
  });
});
