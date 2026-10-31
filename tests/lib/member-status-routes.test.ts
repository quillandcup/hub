import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// The hiatus and status-override routes over the in-memory repositories: the answers and the
// side effect (the cached status is recomputed) on success, and the 500 with the database's message
// when the repository throws.

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, forbidden: false, supabase: {} }),
}));
const recompute = vi.fn(async () => null);
vi.mock("@/lib/member-status", () => ({ recomputeMemberStatus: (...args: unknown[]) => recompute(...(args as [])) }));

import { GET as listOverrides } from "@/app/api/member-overrides/route";
import { PATCH as patchOverride, DELETE as deleteOverride } from "@/app/api/member-overrides/[id]/route";
import { DELETE as deleteHiatus, PATCH as patchHiatus } from "@/app/api/member-hiatus/[id]/route";

const ADA = "mbr_AAAAAAAAAAA1";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown, method = "PATCH") => new NextRequest("http://localhost/api/x", { method, body: JSON.stringify(body) });

beforeEach(() => {
  recompute.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  repos = createInMemoryRepos(new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example", email: "ada@example.test" }] }));
});

describe("member status override routes", () => {
  it("lists overrides with their member", async () => {
    await repos.memberStatus.createStatusOverride({ member_id: ADA, override_type: "gift", reason: "Thanks" });
    const { overrides } = await (await listOverrides(new NextRequest("http://localhost/api/member-overrides"))).json();
    expect(overrides).toHaveLength(1);
    expect(overrides[0].member).toMatchObject({ id: ADA, name: "Ada Example" });
  });

  it("answers a failed read with a 500 and the database's message", async () => {
    vi.spyOn(repos.memberStatus, "statusOverridesWithMember").mockRejectedValue(new Error("read failed"));
    const res = await listOverrides(new NextRequest("http://localhost/api/member-overrides"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "read failed" });
  });

  it("answers a change to an override that is not there with a 500, as the database's no-row error did", async () => {
    const res = await patchOverride(json({ reason: "x" }), ctx("00000000-0000-4000-8000-000000000000"));
    expect(res.status).toBe(500);
  });

  it("changes and deletes an override", async () => {
    const created = await repos.memberStatus.createStatusOverride({ member_id: ADA, override_type: "gift", reason: "Thanks" });
    const changed = await patchOverride(json({ reason: "Thanks a lot" }), ctx(created.id));
    expect((await changed.json()).override).toMatchObject({ reason: "Thanks a lot", member: { id: ADA } });

    const deleted = await deleteOverride(json({}, "DELETE"), ctx(created.id));
    expect(await deleted.json()).toEqual({ success: true });
    expect(await repos.memberStatus.allStatusOverrides()).toEqual([]);
  });

  it("answers a failed delete with a 500 and the database's message", async () => {
    vi.spyOn(repos.memberStatus, "deleteStatusOverride").mockRejectedValue(new Error("delete failed"));
    const res = await deleteOverride(json({}, "DELETE"), ctx("x"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "delete failed" });
  });
});

describe("member hiatus routes", () => {
  it("recomputes the member's status after a change and after a delete", async () => {
    const hiatus = await repos.memberStatus.createHiatus({ member_id: ADA, start_date: "2026-01-01" });

    const changed = await patchHiatus(json({ end_date: "2026-02-01" }), ctx(hiatus.id));
    expect((await changed.json()).hiatus).toMatchObject({ end_date: "2026-02-01" });
    expect(recompute).toHaveBeenLastCalledWith(expect.anything(), ADA);

    recompute.mockClear();
    const deleted = await deleteHiatus(json({}, "DELETE"), ctx(hiatus.id));
    expect(await deleted.json()).toEqual({ success: true });
    expect(recompute).toHaveBeenCalledWith(expect.anything(), ADA);
    expect(await repos.memberStatus.hiatusById(hiatus.id)).toBeNull();
  });

  it("deleting a hiatus that is not there succeeds without recomputing anyone", async () => {
    const res = await deleteHiatus(json({}, "DELETE"), ctx("00000000-0000-4000-8000-000000000000"));
    expect(await res.json()).toEqual({ success: true });
    expect(recompute).not.toHaveBeenCalled();
  });

  it("answers a failed change or delete with a 500 and the database's message", async () => {
    vi.spyOn(repos.memberStatus, "updateHiatus").mockRejectedValue(new Error("update failed"));
    const patched = await patchHiatus(json({ reason: "x" }), ctx("x"));
    expect(patched.status).toBe(500);
    expect(await patched.json()).toEqual({ error: "update failed" });

    vi.spyOn(repos.memberStatus, "deleteHiatus").mockRejectedValue(new Error("delete failed"));
    const deleted = await deleteHiatus(json({}, "DELETE"), ctx("x"));
    expect(deleted.status).toBe(500);
    expect(await deleted.json()).toEqual({ error: "delete failed" });
  });
});
