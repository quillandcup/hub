import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { ACTIVE_HOLD_BAN, HIATUS_BAN, provisionAuthUsers, releaseAuthUsers, type AdminAuthApi, type AuthUserLite } from "@/lib/auth-provisioning";

function fakeAuth(initial: AuthUserLite[] = []) {
  const users = [...initial];
  const calls = { create: [] as { email: string; ban_duration?: string }[], update: [] as string[], pages: 0 };
  const api: AdminAuthApi = {
    async listUsers({ page, perPage }) {
      calls.pages++;
      return { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null };
    },
    async createUser(attrs) {
      calls.create.push({ email: attrs.email, ban_duration: attrs.ban_duration });
      const user: AuthUserLite = { id: `u-${users.length + 1}`, email: attrs.email, banned_until: attrs.ban_duration ? "2999-01-01T00:00:00Z" : null };
      users.push(user);
      return { data: { user }, error: null };
    },
    async updateUserById(id, attrs) {
      calls.update.push(id);
      const u = users.find((x) => x.id === id)!;
      if (attrs.ban_duration === "none") u.banned_until = null;
      return { data: null, error: null };
    },
  };
  return { api, users, calls };
}

const setup = (auth: ReturnType<typeof fakeAuth>) => {
  const data = new InMemoryDataset({
    members: [
      { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "Ada@Example.test" },
      { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test", status: "on_hiatus" },
      { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test", status: "cancelled" },
      { id: "mbr_AAAAAAAAAAA4", name: "Di Example", email: "di@example.test", staffRole: "assistant" },
    ],
  });
  return { data, repos: createInMemoryRepos(data), auth };
};

describe("provisionAuthUsers", () => {
  it("creates banned users for active and hiatus members, staff unbanned, and links them", async () => {
    const { repos, auth } = setup(fakeAuth());
    const report = await provisionAuthUsers(auth.api, repos, { apply: true });
    expect(auth.calls.create).toEqual([
      { email: "ada@example.test", ban_duration: ACTIVE_HOLD_BAN },
      { email: "di@example.test", ban_duration: undefined },
      { email: "bo@example.test", ban_duration: HIATUS_BAN },
    ]);
    expect(report).toMatchObject({ considered: 3, created: 3, createdBanned: 2, unbannedStaff: 1, linked: 3, failed: 0 });
    const members = await repos.members.list();
    expect(members.find((m) => m.id === "mbr_AAAAAAAAAAA1")?.userId).toBeTruthy();
    expect(members.find((m) => m.id === "mbr_AAAAAAAAAAA3")?.userId).toBeNull();
  });

  it("creates at most `limit` users and counts the rest as deferred; a second run finishes them", async () => {
    const { repos, auth } = setup(fakeAuth());
    const first = await provisionAuthUsers(auth.api, repos, { apply: true, limit: 1 });
    expect(first).toMatchObject({ created: 1, deferred: 2 });
    expect(auth.calls.create).toHaveLength(1);

    const second = await provisionAuthUsers(auth.api, repos, { apply: true });
    expect(second).toMatchObject({ created: 2, deferred: 0 });
    expect(auth.calls.create).toHaveLength(3);
  });

  it("never bans a member whose auth user is an admin", async () => {
    const { data, repos, auth } = setup(fakeAuth());
    data.members[0].userId = "admin-1";
    data.userProfiles.push({ id: "admin-1", email: "x@example.test", role: "admin" });
    await provisionAuthUsers(auth.api, repos, { apply: true });
    expect(auth.calls.create[0]).toEqual({ email: "ada@example.test", ban_duration: undefined });
  });

  it("skips existing users (any email case) and links unlinked members", async () => {
    const { repos, auth } = setup(fakeAuth([{ id: "u-old", email: "ADA@example.test" }]));
    const report = await provisionAuthUsers(auth.api, repos, { apply: true });
    expect(report.alreadyExisted).toBe(1);
    expect(report.created).toBe(2);
    expect((await repos.members.list()).find((m) => m.id === "mbr_AAAAAAAAAAA1")?.userId).toBe("u-old");
    expect(auth.calls.create.map((c) => c.email)).not.toContain("ada@example.test");
  });

  it("is idempotent", async () => {
    const { repos, auth } = setup(fakeAuth());
    await provisionAuthUsers(auth.api, repos, { apply: true });
    auth.calls.create.length = 0;
    const second = await provisionAuthUsers(auth.api, repos, { apply: true });
    expect(auth.calls.create).toEqual([]);
    expect(second).toMatchObject({ created: 0, alreadyExisted: 3, linked: 0 });
  });

  it("dry run writes nothing", async () => {
    const { repos, auth } = setup(fakeAuth());
    const report = await provisionAuthUsers(auth.api, repos, { apply: false });
    expect(report.created).toBe(3);
    expect(auth.calls.create).toEqual([]);
    expect((await repos.members.list()).every((m) => m.userId === null)).toBe(true);
  });

  it("reads every page of auth users past 1000", async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({ id: `u${i}`, email: `n${i}@example.test` }));
    many.push({ id: "u-bo", email: "bo@example.test" });
    const { repos, auth } = setup(fakeAuth(many));
    const report = await provisionAuthUsers(auth.api, repos, { apply: true });
    expect(auth.calls.pages).toBe(2);
    expect(report.alreadyExisted).toBe(1);
  });

  it("reports a failed create by member id only", async () => {
    const { repos, auth } = setup(fakeAuth());
    auth.api.createUser = async () => ({ data: null, error: { message: "boom" } });
    const report = await provisionAuthUsers(auth.api, repos, { apply: true });
    expect(report.failed).toBe(3);
    expect(JSON.stringify(report)).not.toContain("@");
  });
});

describe("releaseAuthUsers", () => {
  it("clears bans of active members only, idempotently", async () => {
    const { repos, auth } = setup(fakeAuth());
    await provisionAuthUsers(auth.api, repos, { apply: true });
    const first = await releaseAuthUsers(auth.api, repos, { apply: true });
    expect(first).toMatchObject({ considered: 2, released: 1, alreadyOpen: 1 });
    expect(auth.users.find((u) => u.email === "ada@example.test")?.banned_until).toBeNull();
    expect(auth.users.find((u) => u.email === "bo@example.test")?.banned_until).toBeTruthy();
    const second = await releaseAuthUsers(auth.api, repos, { apply: true });
    expect(second.released).toBe(0);
    expect(auth.calls.update).toHaveLength(1);
  });

  it("releases at most `limit` and counts the rest as deferred; a second run finishes them", async () => {
    const { data, repos, auth } = setup(fakeAuth());
    data.members.push({ id: "mbr_AAAAAAAAAAA5", name: "Ed Example", email: "ed@example.test" } as (typeof data.members)[number]);
    await provisionAuthUsers(auth.api, repos, { apply: true });

    const first = await releaseAuthUsers(auth.api, repos, { apply: true, limit: 1 });
    expect(first).toMatchObject({ released: 1, deferred: 1 });
    expect(auth.calls.update).toHaveLength(1);

    const second = await releaseAuthUsers(auth.api, repos, { apply: true });
    expect(second).toMatchObject({ released: 1, deferred: 0 });
  });

  it("dry run changes nothing and counts members without an auth user", async () => {
    const { repos, auth } = setup(fakeAuth());
    expect(await releaseAuthUsers(auth.api, repos, { apply: false })).toMatchObject({ noAuthUser: 2, released: 0 });
  });
});
