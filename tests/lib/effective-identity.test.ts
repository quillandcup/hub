import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase } from "@/tests/helpers/server-page";

// getEffectiveIdentity decides whose data a member page shows: the sudo'd member for an admin
// with sudo active, otherwise the signed-in user's own member record. Members come from their
// repository (in memory here); only the admin's role is read through the client.

let cookieValue: string | undefined;
let role: string | null = "admin";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "sudo_as" && cookieValue ? { value: cookieValue } : undefined) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeSupabase({ user_profiles: { data: role ? [{ role }] : [] } }) }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { getEffectiveIdentity, signSudoCookie } from "@/lib/sudo";

const ADMIN_USER = { id: "admin-user", email: "admin@example.test" };
const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", userId: "admin-user" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "fern@example.test", userId: "fern-user" };
const GALE = { id: "mbr_AAAAAAAAAAA3", name: "Gale Example", email: "gale@example.test", userId: null };

beforeEach(() => {
  process.env.SUDO_SECRET = "test-secret-that-is-32-chars-xxxx";
  cookieValue = undefined;
  role = "admin";
  repos = createInMemoryRepos(new InMemoryDataset({ members: [ADA, FERN, GALE] }));
});

describe("getEffectiveIdentity", () => {
  it("is the signed-in user's own member, linked by auth user id", async () => {
    expect(await getEffectiveIdentity(ADMIN_USER)).toEqual({
      memberId: ADA.id,
      memberName: ADA.name,
      memberDisplayName: ADA.name,
      memberEmail: ADA.email,
      isSudo: false,
    });
  });

  it("falls back to the member with the user's email when no member is linked to them", async () => {
    const identity = await getEffectiveIdentity({ id: "new-user", email: GALE.email });

    expect(identity).toMatchObject({ memberId: GALE.id, isSudo: false });
  });

  it("prefers the linked member over another member who happens to have the user's email", async () => {
    const identity = await getEffectiveIdentity({ id: FERN.userId, email: GALE.email });

    expect(identity?.memberId).toBe(FERN.id);
  });

  it("is null for a user with no member record", async () => {
    expect(await getEffectiveIdentity({ id: "stranger", email: "stranger@example.test" })).toBeNull();
    expect(await getEffectiveIdentity({ id: "stranger" })).toBeNull();
  });

  it("is the sudo'd member for an admin with a valid sudo cookie", async () => {
    cookieValue = signSudoCookie(ADMIN_USER.id, FERN.id);

    expect(await getEffectiveIdentity(ADMIN_USER)).toEqual({
      memberId: FERN.id,
      memberName: FERN.name,
      memberDisplayName: FERN.name,
      memberEmail: FERN.email,
      isSudo: true,
    });
  });

  it("ignores the sudo cookie when the signed-in user is not an admin", async () => {
    cookieValue = signSudoCookie(ADMIN_USER.id, FERN.id);
    role = "member";

    expect(await getEffectiveIdentity(ADMIN_USER)).toMatchObject({ memberId: ADA.id, isSudo: false });
  });

  it("ignores a sudo cookie issued to a different admin, or for a member that no longer exists", async () => {
    cookieValue = signSudoCookie("someone-else", FERN.id);
    expect(await getEffectiveIdentity(ADMIN_USER)).toMatchObject({ memberId: ADA.id, isSudo: false });

    cookieValue = signSudoCookie(ADMIN_USER.id, "mbr_ZZZZZZZZZZZZ");
    expect(await getEffectiveIdentity(ADMIN_USER)).toMatchObject({ memberId: ADA.id, isSudo: false });
  });

  it("ignores a cookie that is not validly signed", async () => {
    cookieValue = "garbage";

    expect(await getEffectiveIdentity(ADMIN_USER)).toMatchObject({ memberId: ADA.id, isSudo: false });
  });
});
