import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";
import { ambiguousZoomName } from "@/tests/helpers/zoom-fixtures";

// The admin routes that create name aliases (the names attendance is matched by) refuse a name that
// belongs to another member (lib/name-alias-conflict.ts) instead of taking it over.

// `after` only runs inside a request; here it runs at once so the reprocess it schedules can be asserted.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));

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
    const res = await post({ matches: [{ memberId: ADA.id, zoomName: "Ada E" }, { memberId: FERN.id, zoomName: "Fern E" }] });

    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: ADA.id, p_alias: "Ada E" });
    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: FERN.id, p_alias: "Fern E" });
    expect(dataset.nameAliases.map((a) => [a.member_id, a.alias, a.source])).toEqual([[ADA.id, "Ada E", "zoom"], [FERN.id, "Fern E", "zoom"]]);
  });

  it("saves nothing when any name is taken, and says whose it is", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce(conflictRow("other_alias"));

    const res = await post({ matches: [{ memberId: ADA.id, zoomName: "Ada E" }, { memberId: ADA.id, zoomName: "Fern E" }] });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(`"Fern E" is already an alias for Fern Example. Move it from there first.`);
    expect(dataset.nameAliases).toEqual([]);
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
    expect(dataset.nameAliases).toEqual([]);
  });
});

describe("POST /api/zoom/resolve-ambiguous", () => {
  beforeEach(() => {
    dataset.ambiguousZoomNames.push(ambiguousZoomName({ zoom_name: "Katie" }));
  });
  const post = (body: unknown) =>
    resolveAmbiguous(new NextRequest("http://localhost/api/zoom/resolve-ambiguous", { method: "POST", body: JSON.stringify(body) }));

  it("adds the alias and resolves the name when it is free", async () => {
    const res = await post({ zoomName: "Katie", memberId: ADA.id });

    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("name_alias_conflict", { p_member_id: ADA.id, p_alias: "Katie" });
    expect(dataset.nameAliases.map((a) => [a.member_id, a.alias, a.source])).toEqual([[ADA.id, "Katie", "zoom"]]);
    expect(dataset.ambiguousZoomNames.map((r) => [r.status, r.resolved_member_id])).toEqual([["resolved", ADA.id]]);
    expect(triggerReprocessingMock).toHaveBeenCalledWith("member_name_aliases", "local");
  });

  it("reports it when the alias can't be saved, and leaves the name unresolved", async () => {
    vi.spyOn(repos.aliases, "upsertName").mockRejectedValue(new Error("db down"));

    const res = await post({ zoomName: "Katie", memberId: ADA.id });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
    expect(dataset.ambiguousZoomNames.map((r) => r.status)).toEqual(["unresolved"]);
  });

  it("doesn't take the name from another member", async () => {
    rpcMock.mockResolvedValue(conflictRow("other_alias"));

    const res = await post({ zoomName: "Katie", memberId: ADA.id });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already an alias for Fern Example");
    expect(dataset.nameAliases).toEqual([]);
    expect(dataset.ambiguousZoomNames.map((r) => r.status)).toEqual(["unresolved"]);
  });

  it("doesn't shadow another member's real name when the name isn't an ambiguous one", async () => {
    rpcMock.mockResolvedValue(conflictRow("other_name"));
    expect((await post({ zoomName: "Fern Example", memberId: ADA.id })).status).toBe(409);
    expect(dataset.nameAliases).toEqual([]);
  });

  it("lets the admin pick who uses a name that is another member's real name, when it is ambiguous", async () => {
    dataset.ambiguousZoomNames.push(ambiguousZoomName({ zoom_name: "Fern" }));
    rpcMock.mockResolvedValue(conflictRow("other_name"));

    const res = await post({ zoomName: "Fern", memberId: ADA.id });

    expect(res.status).toBe(200);
    expect(dataset.nameAliases.map((a) => [a.member_id, a.alias, a.source])).toEqual([[ADA.id, "Fern", "zoom"]]);
    expect(triggerReprocessingMock).toHaveBeenCalledWith("member_name_aliases", "local");
  });

  it("reports a failed lookup of the ambiguous name", async () => {
    vi.spyOn(repos.zoom, "hasUnresolvedAmbiguousName").mockRejectedValue(new Error("lookup down"));
    rpcMock.mockResolvedValue(conflictRow("other_name"));

    const res = await post({ zoomName: "Fern", memberId: ADA.id });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("lookup down");
    expect(dataset.nameAliases).toEqual([]);
  });

  it("just resolves when the member already has that name switched on", async () => {
    rpcMock.mockResolvedValue(conflictRow("own", null));

    const res = await post({ zoomName: "Katie", memberId: ADA.id });

    expect(res.status).toBe(200);
    expect(dataset.nameAliases).toEqual([]);
    expect(dataset.ambiguousZoomNames.map((r) => [r.status, r.resolved_member_id])).toEqual([["resolved", ADA.id]]);
  });

  it("marks the name ignored without making an alias", async () => {
    const res = await post({ zoomName: "Katie", action: "ignore" });

    expect(res.status).toBe(200);
    expect(dataset.ambiguousZoomNames.map((r) => r.status)).toEqual(["ignored"]);
    expect(dataset.nameAliases).toEqual([]);
    expect(triggerReprocessingMock).not.toHaveBeenCalled();
  });

  it("reports a failed ignore", async () => {
    vi.spyOn(repos.zoom, "ignoreAmbiguousName").mockRejectedValue(new Error("ignore down"));
    const res = await post({ zoomName: "Katie", action: "ignore" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "ignore down" });
  });

  it("reports a failed resolve after the alias is saved", async () => {
    vi.spyOn(repos.zoom, "resolveAmbiguousName").mockRejectedValue(new Error("resolve down"));
    const res = await post({ zoomName: "Katie", memberId: ADA.id });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "resolve down" });
    expect(triggerReprocessingMock).not.toHaveBeenCalled();
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
    expect(dataset.nameAliases).toEqual([]);
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

describe("PATCH /api/admin/members/[id] -- when the alias store fails", () => {
  const patch = (id: string, body: unknown) =>
    patchMember(new NextRequest(`http://localhost/api/admin/members/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });
  const failing = (method: "upsertName" | "addName" | "setNameActive" | "setEmailActive" | "removeEmailOf" | "addEmail") =>
    vi.spyOn(repos.aliases, method).mockRejectedValue(new Error("db down"));

  it("reports it when keeping the old name as a pen name can't be saved", async () => {
    updateContactMock.mockResolvedValue({});
    failing("upsertName");
    const res = await patch(ADA.id, { name: "Ada Newname", keepOldNameAsPenName: true });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
    expect(await repos.members.byId(ADA.id)).toMatchObject({ name: "Ada Example" });
  });

  it("reports it when a new pen name can't be saved", async () => {
    failing("addName");
    const res = await patch(ADA.id, { newPenName: "Ada E" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
  });

  it("reports it when a pen name can't be switched", async () => {
    failing("setNameActive");
    const res = await patch(FERN.id, { nameAlias: { id: "nal_x", active: true } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
  });

  it("reports it when an email alias can't be switched", async () => {
    failing("setEmailActive");
    const res = await patch(FERN.id, { emailAlias: { id: "eal_x", active: true } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
  });

  it("reports it when the old primary email can't be kept as an alias", async () => {
    failing("removeEmailOf");
    const res = await patch(FERN.id, { email: "fern.new@example.test" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
  });

  it("reports it when a new email alias can't be saved", async () => {
    failing("addEmail");
    const res = await patch(FERN.id, { newEmailAlias: "fern.alt@example.test" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
  });
});

describe("PATCH /api/admin/members/[id] -- the lists it returns", () => {
  it("returns the member's names and their email aliases ordered by address", async () => {
    dataset.nameAliases.push({ id: "nal_1", member_id: FERN.id, alias: "Fern E", source: "zoom", active: true });
    dataset.emailAliases.push(
      { id: "eal_1", memberId: FERN.id, alias_email: "zed@example.test", canonical_email: FERN.email, active: true },
      { id: "eal_2", memberId: FERN.id, alias_email: "ada@example.test", canonical_email: FERN.email, active: false }
    );

    const res = await patchMember(new NextRequest(`http://localhost/api/admin/members/${FERN.id}`, { method: "PATCH", body: JSON.stringify({}) }), {
      params: Promise.resolve({ id: FERN.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aliases).toEqual([{ id: "nal_1", alias: "Fern E", source: "zoom", active: true }]);
    expect(body.emailAliases.map((a: { alias_email: string }) => a.alias_email)).toEqual(["ada@example.test", "zed@example.test"]);
  });
});

describe("PATCH /api/admin/members/[id] -- switching a pen name", () => {
  const patch = (id: string, body: unknown) =>
    patchMember(new NextRequest(`http://localhost/api/admin/members/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });

  it("reactivates the member's pen name and reprocesses recent attendance", async () => {
    dataset.nameAliases.push({ id: "nal_1", member_id: FERN.id, alias: "Fern Old", source: "zoom", active: false });

    const res = await patch(FERN.id, { nameAlias: { id: "nal_1", active: true } });

    expect(res.status).toBe(200);
    expect(dataset.nameAliases[0].active).toBe(true);
    expect((await res.json()).aliases).toEqual([{ id: "nal_1", alias: "Fern Old", source: "zoom", active: true }]);
    expect(triggerReprocessingMock).toHaveBeenCalledWith("member_name_aliases", "local");
  });

  it("deactivates without reprocessing", async () => {
    dataset.nameAliases.push({ id: "nal_1", member_id: FERN.id, alias: "Fern Old", source: "zoom", active: true });

    const res = await patch(FERN.id, { nameAlias: { id: "nal_1", active: false } });

    expect(res.status).toBe(200);
    expect(dataset.nameAliases[0].active).toBe(false);
    expect(triggerReprocessingMock).not.toHaveBeenCalled();
  });

  it("won't switch another member's pen name", async () => {
    dataset.nameAliases.push({ id: "nal_1", member_id: ADA.id, alias: "Ada Old", source: "zoom", active: false });

    const res = await patch(FERN.id, { nameAlias: { id: "nal_1", active: true } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "That pen name isn't on file for this member" });
    expect(dataset.nameAliases[0].active).toBe(false);
  });

  it("won't make an inactive pen name the default, and does once it is active", async () => {
    dataset.nameAliases.push({ id: "nal_1", member_id: FERN.id, alias: "Fern Old", source: "zoom", active: false });

    const refused = await patch(FERN.id, { displayName: "Fern Old" });

    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "That pen name is inactive. Reactivate it first." });
    expect((await repos.members.byId(FERN.id))?.displayName ?? null).toBeNull();

    await patch(FERN.id, { nameAlias: { id: "nal_1", active: true } });
    const accepted = await patch(FERN.id, { displayName: "Fern Old" });

    expect(accepted.status).toBe(200);
    expect(await repos.members.byId(FERN.id)).toMatchObject({ displayName: "Fern Old" });
  });
});
