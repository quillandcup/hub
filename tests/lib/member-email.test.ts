/**
 * Changing a member's primary email: the sign-in account, Kajabi, the member and the aliases move together,
 * and a confirmed member-requested change is finished exactly once, only when the member asked for it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos: ReturnType<typeof createInMemoryRepos>;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const updateContact = vi.fn();
vi.mock("@/lib/kajabi/client", () => ({ createKajabiClient: () => ({ updateContact }) }));
const refreshBronze = vi.fn();
vi.mock("@/lib/kajabi/contact-refresh", () => ({ refreshKajabiContactInBronze: (...args: unknown[]) => refreshBronze(...args) }));

import { applyConfirmedEmailChange, changePrimaryEmail, normalizeEmail, PENDING_EMAIL_KEY } from "@/lib/member-email";

const db = {} as never;
const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const USER = "00000000-0000-4000-8000-000000000001";
const authUser = (id: string, email: string, appMetadata: Record<string, unknown> = {}) => ({
  id, email, confirmed: true, createdAt: "2026-01-01T00:00:00Z", bannedUntil: null, lastSignInAt: null, appMetadata,
});

let dataset: InMemoryDataset;
const me = (extra: Partial<{ kajabiId: string | null; userId: string | null }> = {}) => ({
  id: ME, email: "old@example.com", kajabiId: null as string | null, userId: USER as string | null, ...extra,
});

beforeEach(() => {
  updateContact.mockReset().mockResolvedValue(undefined);
  refreshBronze.mockReset().mockResolvedValue(undefined);
  dataset = new InMemoryDataset({
    members: [
      { id: ME, name: "Ada Example", email: "old@example.com", userId: USER, kajabiId: "kaj1" },
      { id: OTHER, name: "Grace Example", email: "taken@example.com" },
    ],
    authUsers: [authUser(USER, "old@example.com")],
  });
  repos = createInMemoryRepos(dataset);
});

describe("normalizeEmail", () => {
  it("lowercases and trims, and rejects what isn't an address", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail("nope")).toBeNull();
  });
});

describe("changePrimaryEmail", () => {
  it("moves the sign-in account, Kajabi and the member, and keeps the old address as an alias", async () => {
    const result = await changePrimaryEmail({ repos, service: db, member: me({ kajabiId: "kaj1" }), address: "new@example.com" });

    expect(result).toEqual({ ok: true, changed: true });
    expect((await repos.authUsers.byId(USER))!.email).toBe("new@example.com");
    expect(updateContact).toHaveBeenCalledWith("kaj1", { email: "new@example.com" });
    expect((await repos.members.byId(ME))!.email).toBe("new@example.com");
    expect((await repos.aliases.emailsOf(ME)).map((a) => a.alias_email)).toEqual(["old@example.com"]);
  });

  it("does nothing for the address they already have", async () => {
    expect(await changePrimaryEmail({ repos, service: db, member: me(), address: "old@example.com" })).toEqual({ ok: true, changed: false });
    expect(updateContact).not.toHaveBeenCalled();
  });

  it("refuses an address another member has, or has as an alias, before touching anything", async () => {
    const held = await changePrimaryEmail({ repos, service: db, member: me(), address: "taken@example.com" });
    expect(held).toMatchObject({ ok: false, status: 409, conflictingMemberId: OTHER });

    await repos.aliases.upsertEmail(OTHER, "alias@example.com", "manual", true);
    const alias = await changePrimaryEmail({ repos, service: db, member: me(), address: "alias@example.com" });
    expect(alias).toMatchObject({ ok: false, status: 409, conflictingMemberId: OTHER });
    expect((await repos.authUsers.byId(USER))!.email).toBe("old@example.com");
  });

  it("refuses an address another sign-in account has, leaving Kajabi and the member alone", async () => {
    dataset.authUsers.push(authUser("00000000-0000-4000-8000-000000000002", "orphan@example.com"));
    const result = await changePrimaryEmail({ repos, service: db, member: me({ kajabiId: "kaj1" }), address: "orphan@example.com" });

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(updateContact).not.toHaveBeenCalled();
    expect((await repos.members.byId(ME))!.email).toBe("old@example.com");
  });

  it("puts the sign-in email back when Kajabi refuses", async () => {
    updateContact.mockRejectedValue(new Error("Kajabi is down"));
    const result = await changePrimaryEmail({ repos, service: db, member: me({ kajabiId: "kaj1" }), address: "new@example.com" });

    expect(result).toEqual({ ok: false, status: 502, error: "Kajabi is down" });
    expect((await repos.authUsers.byId(USER))!.email).toBe("old@example.com");
    expect((await repos.members.byId(ME))!.email).toBe("old@example.com");
  });

  it("patches Bronze directly when the refresh fails after Kajabi changed", async () => {
    refreshBronze.mockRejectedValue(new Error("refresh failed"));
    const patch = vi.spyOn(repos.billing, "setKajabiContactEmail").mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await changePrimaryEmail({ repos, service: db, member: me({ kajabiId: "kaj1" }), address: "new@example.com" });

    expect(result).toEqual({ ok: true, changed: true });
    expect(patch).toHaveBeenCalledWith("kaj1", "new@example.com");
  });

  it("works for a member without a sign-in account or a Kajabi contact", async () => {
    const result = await changePrimaryEmail({ repos, service: db, member: me({ userId: null }), address: "new@example.com" });

    expect(result).toEqual({ ok: true, changed: true });
    expect(updateContact).not.toHaveBeenCalled();
    expect((await repos.authUsers.byId(USER))!.email).toBe("old@example.com");
  });
});

describe("applyConfirmedEmailChange", () => {
  const confirm = (pending: string, accountEmail = pending) => {
    dataset.authUsers[0] = authUser(USER, accountEmail, { [PENDING_EMAIL_KEY]: pending });
  };

  it("finishes a change the member asked for once the account has the new address, and clears the marker", async () => {
    confirm("new@example.com");

    expect(await applyConfirmedEmailChange(db, USER)).toBe("new@example.com");

    expect((await repos.members.byId(ME))!.email).toBe("new@example.com");
    expect(updateContact).toHaveBeenCalledWith("kaj1", { email: "new@example.com" });
    expect((await repos.authUsers.byId(USER))!.appMetadata).not.toHaveProperty(PENDING_EMAIL_KEY);
    expect(await applyConfirmedEmailChange(db, USER)).toBeNull();
  });

  it("waits while the link hasn't been opened (the account still has the old address)", async () => {
    confirm("new@example.com", "old@example.com");

    expect(await applyConfirmedEmailChange(db, USER)).toBeNull();
    expect((await repos.members.byId(ME))!.email).toBe("old@example.com");
    expect((await repos.authUsers.byId(USER))!.appMetadata).toHaveProperty(PENDING_EMAIL_KEY);
  });

  it("ignores a difference nobody asked for (Kajabi changed the member's email, the account has the old one)", async () => {
    dataset.members[0].email = "kajabi-new@example.com";
    expect(await applyConfirmedEmailChange(db, USER)).toBeNull();
    expect((await repos.members.byId(ME))!.email).toBe("kajabi-new@example.com");
  });

  it("returns the sign-in to the member's email when someone took the address meanwhile", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    confirm("taken@example.com");

    expect(await applyConfirmedEmailChange(db, USER)).toBeNull();

    const account = (await repos.authUsers.byId(USER))!;
    expect(account.email).toBe("old@example.com");
    expect(account.appMetadata).not.toHaveProperty(PENDING_EMAIL_KEY);
  });

  it("keeps the marker to retry when Kajabi is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    updateContact.mockRejectedValue(new Error("Kajabi is down"));
    confirm("new@example.com");

    expect(await applyConfirmedEmailChange(db, USER)).toBeNull();
    expect((await repos.authUsers.byId(USER))!.appMetadata).toHaveProperty(PENDING_EMAIL_KEY);

    updateContact.mockResolvedValue(undefined);
    expect(await applyConfirmedEmailChange(db, USER)).toBe("new@example.com");
  });

  it("drops the marker when the account isn't linked to a member", async () => {
    confirm("new@example.com");
    dataset.members[0].userId = null;

    expect(await applyConfirmedEmailChange(db, USER)).toBeNull();
    expect((await repos.authUsers.byId(USER))!.appMetadata).not.toHaveProperty(PENDING_EMAIL_KEY);
  });
});
