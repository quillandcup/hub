import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { ROLE_CHANGE_REFUSALS as R } from "@/lib/permissions";

/** The Users route (PATCH roles, DELETE) refuses what the person asking may not do, with the reason, before the database is asked. */

const ADMIN = "00000000-0000-4000-a000-0000000000a1";
const ADMIN2 = "00000000-0000-4000-a000-0000000000a2";
const ASSISTANT = "00000000-0000-4000-a000-0000000000b1";
const ASSISTANT2 = "00000000-0000-4000-a000-0000000000b2";
const CM = "00000000-0000-4000-a000-0000000000c1";
const MEMBER = "00000000-0000-4000-a000-0000000000d1";

let data: InMemoryDataset;
let actor = ADMIN;

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/supabase/api-auth", () => ({
  requireApiPermission: vi.fn(async () => ({ user: { id: actor }, forbidden: false, supabase: {} })),
}));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: () => actual.createInMemoryRepos(data) };
});

const { PATCH, DELETE } = await import("@/app/api/admin/users/[id]/route");

const profile = (id: string, role: string) => ({ id, email: `${id.slice(-2)}@example.test`, role });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  actor = ADMIN;
  data = new InMemoryDataset({
    userProfiles: [profile(ADMIN, "admin"), profile(ADMIN2, "admin"), profile(ASSISTANT, "assistant"), profile(ASSISTANT2, "assistant"), profile(CM, "community_manager"), profile(MEMBER, "member")],
    authUsers: [MEMBER, CM, ASSISTANT2, ADMIN2].map((id) => ({ id, email: `${id.slice(-2)}@example.test`, confirmed: true, createdAt: "2026-01-01T00:00:00Z", lastSignInAt: null, bannedUntil: null, appMetadata: {} })) as never,
  });
});

const patch = (id: string, body: unknown) =>
  PATCH(new NextRequest(`http://localhost/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const del = (id: string) => DELETE(new NextRequest(`http://localhost/api/admin/users/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
const rolesOf = (id: string) => createInMemoryRepos(data).profiles.rolesOf(id);

describe("PATCH roles", () => {
  it("lets an assistant give a community manager and a conversion specialist role", async () => {
    actor = ASSISTANT;
    const res = await patch(MEMBER, { roles: ["conversion_specialist", "community_manager"] });
    expect(res.status).toBe(200);
    expect(await rolesOf(MEMBER)).toEqual(["community_manager", "conversion_specialist"]);
  });

  it("refuses an assistant giving admin or assistant, with the reason", async () => {
    actor = ASSISTANT;
    for (const role of ["admin", "assistant"]) {
      const res = await patch(MEMBER, { roles: [role] });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(R.assistantRoles);
    }
    expect(await rolesOf(MEMBER)).toEqual([]);
  });

  it("refuses an assistant changing an admin or another assistant", async () => {
    actor = ASSISTANT;
    for (const id of [ADMIN2, ASSISTANT2]) {
      const res = await patch(id, { roles: [] });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(R.assistantOnAdmin);
    }
    expect(await rolesOf(ADMIN2)).toEqual(["admin"]);
  });

  it("refuses someone who manages no roles", async () => {
    actor = CM;
    const res = await patch(MEMBER, { roles: ["community_manager"] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(R.notManager);
  });

  it("lets an admin give admin, and remove another admin while one is left", async () => {
    expect((await patch(MEMBER, { roles: ["admin"] })).status).toBe(200);
    expect((await patch(ADMIN2, { roles: [] })).status).toBe(200);
    expect(await rolesOf(ADMIN2)).toEqual([]);
  });

  it("refuses an admin removing their own admin role", async () => {
    const res = await patch(ADMIN, { roles: ["community_manager"] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(R.ownAdmin);
    expect(await rolesOf(ADMIN)).toEqual(["admin"]);
  });

  it("accepts the single `role` the same way", async () => {
    actor = ASSISTANT;
    expect((await patch(MEMBER, { role: "admin" })).status).toBe(403);
    expect((await patch(MEMBER, { role: "community_manager" })).status).toBe(200);
  });
});

describe("DELETE a user", () => {
  it("refuses an assistant deleting an admin or another assistant, and allows a community manager account", async () => {
    actor = ASSISTANT;
    for (const id of [ADMIN2, ASSISTANT2]) {
      const res = await del(id);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(R.assistantOnAdmin);
    }
    expect((await del(CM)).status).toBe(200);
  });

  it("lets an admin delete another admin while one is left", async () => {
    expect((await del(ADMIN2)).status).toBe(200);
  });
});
