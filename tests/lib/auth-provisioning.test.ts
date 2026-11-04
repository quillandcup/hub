import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/data/auth-users";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { ACTIVE_HOLD_BAN, HIATUS_BAN, provisionAuthUsers, releaseAuthUsers } from "@/lib/auth-provisioning";

const authUser = (id: string, email: string): AuthUser => ({ id, email, confirmed: true, createdAt: "2026-10-01T00:00:00Z", bannedUntil: null, lastSignInAt: null, appMetadata: {} });

/** The repositories over the members below and these auth accounts, with spies on what a run asks of Auth. */
const setup = (authUsers: AuthUser[] = []) => {
  const data = new InMemoryDataset({
    authUsers,
    members: [
      { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "Ada@Example.test" },
      { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test", status: "on_hiatus" },
      { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test", status: "cancelled" },
      { id: "mbr_AAAAAAAAAAA4", name: "Di Example", email: "di@example.test", staffRole: "assistant" },
    ],
  });
  const repos = createInMemoryRepos(data);
  const create = vi.spyOn(repos.authUsers, "create");
  const setBan = vi.spyOn(repos.authUsers, "setBan");
  const created = () => create.mock.calls.map(([input]) => ({ email: input.email, banDuration: input.banDuration }));
  return { data, repos, create, setBan, created };
};

describe("provisionAuthUsers", () => {
  it("creates banned users for active and hiatus members, staff unbanned, and links them", async () => {
    const { repos, created } = setup();
    const report = await provisionAuthUsers(repos, { apply: true });
    expect(created()).toEqual([
      { email: "ada@example.test", banDuration: ACTIVE_HOLD_BAN },
      { email: "di@example.test", banDuration: undefined },
      { email: "bo@example.test", banDuration: HIATUS_BAN },
    ]);
    expect(report).toMatchObject({ considered: 3, created: 3, createdBanned: 2, unbannedStaff: 1, linked: 3, failed: 0 });
    const members = await repos.members.list();
    expect(members.find((m) => m.id === "mbr_AAAAAAAAAAA1")?.userId).toBeTruthy();
    expect(members.find((m) => m.id === "mbr_AAAAAAAAAAA3")?.userId).toBeNull();
  });

  it("creates at most `limit` users and counts the rest as deferred; a second run finishes them", async () => {
    const { repos, created } = setup();
    const first = await provisionAuthUsers(repos, { apply: true, limit: 1 });
    expect(first).toMatchObject({ created: 1, deferred: 2 });
    expect(created()).toHaveLength(1);

    const second = await provisionAuthUsers(repos, { apply: true });
    expect(second).toMatchObject({ created: 2, deferred: 0 });
    expect(created()).toHaveLength(3);
  });

  it("never bans a member whose auth user is an admin", async () => {
    const { data, repos, created } = setup();
    data.members[0].userId = "admin-1";
    data.userProfiles.push({ id: "admin-1", email: "x@example.test", role: "admin" });
    await provisionAuthUsers(repos, { apply: true });
    expect(created()[0]).toEqual({ email: "ada@example.test", banDuration: undefined });
  });

  it("skips existing users (any email case) and links unlinked members", async () => {
    const { repos, created } = setup([authUser("u-old", "ADA@example.test")]);
    const report = await provisionAuthUsers(repos, { apply: true });
    expect(report.alreadyExisted).toBe(1);
    expect(report.created).toBe(2);
    expect((await repos.members.list()).find((m) => m.id === "mbr_AAAAAAAAAAA1")?.userId).toBe("u-old");
    expect(created().map((c) => c.email)).not.toContain("ada@example.test");
  });

  it("is idempotent", async () => {
    const { repos, create } = setup();
    await provisionAuthUsers(repos, { apply: true });
    create.mockClear();
    const second = await provisionAuthUsers(repos, { apply: true });
    expect(create).not.toHaveBeenCalled();
    expect(second).toMatchObject({ created: 0, alreadyExisted: 3, linked: 0 });
  });

  it("dry run writes nothing", async () => {
    const { repos, create } = setup();
    const report = await provisionAuthUsers(repos, { apply: false });
    expect(report.created).toBe(3);
    expect(create).not.toHaveBeenCalled();
    expect((await repos.members.list()).every((m) => m.userId === null)).toBe(true);
  });

  it("sees every existing user, however many there are", async () => {
    const many = Array.from({ length: 1500 }, (_, i) => authUser(`u${i}`, `n${i}@example.test`));
    many.push(authUser("u-bo", "bo@example.test"));
    const { repos } = setup(many);
    const report = await provisionAuthUsers(repos, { apply: true });
    expect(report.alreadyExisted).toBe(1);
  });

  it("reports a failed create by member id only", async () => {
    const { repos, create } = setup();
    create.mockRejectedValue(new Error("boom"));
    const report = await provisionAuthUsers(repos, { apply: true });
    expect(report.failed).toBe(3);
    expect(JSON.stringify(report)).not.toContain("@");
  });

  it("reports a member it could not link by id, and does not count them as linked", async () => {
    const { repos } = setup([authUser("u-old", "ada@example.test")]);
    vi.spyOn(repos.members, "linkAuthUser").mockRejectedValue(new Error("boom"));
    const report = await provisionAuthUsers(repos, { apply: true });
    expect(report.failedMemberIds).toContain("mbr_AAAAAAAAAAA1");
    expect(report.linked).toBe(0);
  });
});

describe("releaseAuthUsers", () => {
  const bannedUntil = (data: ReturnType<typeof setup>["data"], email: string) => data.authUsers.find((u) => u.email === email)?.bannedUntil;

  it("clears bans of active members only, idempotently", async () => {
    const { data, repos, setBan } = setup();
    await provisionAuthUsers(repos, { apply: true });
    const first = await releaseAuthUsers(repos, { apply: true });
    expect(first).toMatchObject({ considered: 2, released: 1, alreadyOpen: 1 });
    expect(bannedUntil(data, "ada@example.test")).toBeNull();
    expect(bannedUntil(data, "bo@example.test")).toBeTruthy();
    const second = await releaseAuthUsers(repos, { apply: true });
    expect(second.released).toBe(0);
    expect(setBan).toHaveBeenCalledTimes(1);
  });

  it("releases at most `limit` and counts the rest as deferred; a second run finishes them", async () => {
    const { data, repos, setBan } = setup();
    data.members.push({ id: "mbr_AAAAAAAAAAA5", name: "Ed Example", email: "ed@example.test" } as (typeof data.members)[number]);
    await provisionAuthUsers(repos, { apply: true });

    const first = await releaseAuthUsers(repos, { apply: true, limit: 1 });
    expect(first).toMatchObject({ released: 1, deferred: 1 });
    expect(setBan).toHaveBeenCalledTimes(1);

    const second = await releaseAuthUsers(repos, { apply: true });
    expect(second).toMatchObject({ released: 1, deferred: 0 });
  });

  it("dry run changes nothing and counts members without an auth user", async () => {
    const { repos } = setup();
    expect(await releaseAuthUsers(repos, { apply: false })).toMatchObject({ noAuthUser: 2, released: 0 });
  });

  it("reports a member whose ban could not be lifted by id", async () => {
    const { repos, setBan } = setup();
    await provisionAuthUsers(repos, { apply: true });
    setBan.mockRejectedValue(new Error("boom"));
    const report = await releaseAuthUsers(repos, { apply: true });
    expect(report).toMatchObject({ released: 0, failed: 1, failedMemberIds: ["mbr_AAAAAAAAAAA1"] });
  });
});
