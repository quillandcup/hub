import { describe, expect, it, vi } from "vitest";
import { SupabaseAuthUserRepository } from "@/lib/data/auth-users";
import type { Db } from "@/lib/data/db";

const goTrueUser = (i: number, extra: object = {}) => ({ id: `u${i}`, email: `User${i}@Example.test`, created_at: "2026-01-01T00:00:00Z", ...extra });
const fail = (message: string, extra: object = {}) => ({ data: { user: null }, error: { message, ...extra } });

function repoOver(admin: object) {
  return new SupabaseAuthUserRepository({ auth: { admin } } as unknown as Db);
}

describe("SupabaseAuthUserRepository over a fake admin API", () => {
  it("reads every page of accounts, however many there are", async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => goTrueUser(i)), Array.from({ length: 1000 }, (_, i) => goTrueUser(1000 + i)), [goTrueUser(2000)]];
    const listUsers = vi.fn(async ({ page }: { page: number }) => ({ data: { users: pages[page - 1] }, error: null }));
    const all = await repoOver({ listUsers }).all();
    expect(all).toHaveLength(2001);
    expect(listUsers.mock.calls.map(([params]) => params)).toEqual([
      { page: 1, perPage: 1000 },
      { page: 2, perPage: 1000 },
      { page: 3, perPage: 1000 },
    ]);
  });

  it("stops after a page that is exactly full only when the next is empty", async () => {
    const listUsers = vi.fn(async ({ page }: { page: number }) => ({ data: { users: page === 1 ? Array.from({ length: 1000 }, (_, i) => goTrueUser(i)) : [] }, error: null }));
    expect(await repoOver({ listUsers }).all()).toHaveLength(1000);
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it("maps an account to the fields Hub uses: lowercase email, confirmed flag, a ban only when it is a date", async () => {
    const listUsers = async () => ({
      data: { users: [goTrueUser(1, { email_confirmed_at: "2026-02-01T00:00:00Z", banned_until: "2999-01-01T00:00:00Z", last_sign_in_at: "2026-03-01T00:00:00Z", app_metadata: { a: 1 } }), goTrueUser(2, { banned_until: "none" }), { id: "u3", created_at: "2026-01-01T00:00:00Z" }] },
      error: null,
    });
    const [first, second, third] = await repoOver({ listUsers }).all();
    expect(first).toEqual({ id: "u1", email: "user1@example.test", confirmed: true, createdAt: "2026-01-01T00:00:00Z", bannedUntil: "2999-01-01T00:00:00Z", lastSignInAt: "2026-03-01T00:00:00Z", appMetadata: { a: 1 } });
    expect(second).toMatchObject({ confirmed: false, bannedUntil: null, lastSignInAt: null, appMetadata: {} });
    expect(third.email).toBeNull();
  });

  it("throws the admin API's message when listing fails", async () => {
    await expect(repoOver({ listUsers: async () => ({ data: { users: [] }, error: { message: "boom" } }) }).all()).rejects.toThrow("boom");
  });

  it("answers null for a missing account, by status or by code, and throws for any other error", async () => {
    const missing = (extra: object) => repoOver({ getUserById: async () => fail("User not found", extra) });
    expect(await missing({ status: 404 }).byId("x")).toBeNull();
    expect(await missing({ code: "user_not_found" }).byId("x")).toBeNull();
    await expect(missing({ status: 500 }).byId("x")).rejects.toThrow("User not found");
    expect(await repoOver({ getUserById: async () => ({ data: { user: null }, error: null }) }).byId("x")).toBeNull();
  });

  it("throws the admin API's message from every write, and when a create or invite returns no user", async () => {
    const error = { message: "nope" };
    const admin = {
      createUser: async () => ({ data: { user: null }, error }),
      inviteUserByEmail: async () => ({ data: { user: null }, error }),
      updateUserById: async () => ({ data: { user: null }, error }),
      generateLink: async () => ({ data: null, error }),
      deleteUser: async () => ({ data: null, error }),
    };
    const repo = repoOver(admin);
    await expect(repo.create({ email: "a@example.test" })).rejects.toThrow("nope");
    await expect(repo.invite("a@example.test")).rejects.toThrow("nope");
    await expect(repo.setBan("u1", "none")).rejects.toThrow("nope");
    await expect(repo.mergeAppMetadata("u1", { a: 1 })).rejects.toThrow("nope");
    await expect(repoOver({ ...admin, getUserById: async () => ({ data: { user: goTrueUser(1) }, error: null }) }).generateMagicLink("u1")).rejects.toThrow("nope");
    await expect(repoOver({ ...admin, getUserById: async () => ({ data: { user: null }, error: null }) }).generateMagicLink("u1")).rejects.toThrow("User not found");
    await expect(repo.delete("u1")).rejects.toThrow("nope");

    const silent = repoOver({ getUserById: async () => ({ data: { user: goTrueUser(1) }, error: null }), createUser: async () => ({ data: { user: null }, error: null }), inviteUserByEmail: async () => ({ data: { user: null }, error: null }), generateLink: async () => ({ data: { properties: {} }, error: null }) });
    await expect(silent.create({ email: "a@example.test" })).rejects.toThrow("No user was created");
    await expect(silent.invite("a@example.test")).rejects.toThrow("No invite was sent");
    await expect(silent.generateMagicLink("u1")).rejects.toThrow("No sign-in link was generated");
  });

  it("sends a confirmed create with the ban, and a magic link request, as the admin API expects", async () => {
    const createUser = vi.fn(async () => ({ data: { user: goTrueUser(1) }, error: null }));
    const updateUserById = vi.fn(async () => ({ data: { user: goTrueUser(1) }, error: null }));
    const generateLink = vi.fn(async () => ({ data: { properties: { hashed_token: "hash", email_otp: "12345678" } }, error: null }));
    const repo = repoOver({ createUser, updateUserById, generateLink, getUserById: async () => ({ data: { user: goTrueUser(1) }, error: null }) });
    await repo.create({ email: "a@example.test", banDuration: "8760h" });
    await repo.create({ email: "b@example.test" });
    await repo.setBan("u1", "none");
    expect(await repo.generateMagicLink("u1")).toEqual({ hashedToken: "hash", code: "12345678" });
    expect(createUser.mock.calls).toEqual([[{ email: "a@example.test", email_confirm: true, ban_duration: "8760h" }], [{ email: "b@example.test", email_confirm: true }]]);
    expect(updateUserById).toHaveBeenCalledWith("u1", { ban_duration: "none" });
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "user1@example.test" });
  });
});
