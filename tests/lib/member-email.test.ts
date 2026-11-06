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
const fetchWithAttachments = vi.fn();
vi.mock("@/lib/kajabi/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kajabi/client")>()),
  createKajabiClient: () => ({ updateContact, fetchContactWithAttachments: fetchWithAttachments }),
}));
const refreshBronze = vi.fn();
vi.mock("@/lib/kajabi/contact-refresh", () => ({ refreshKajabiContactInBronze: (...args: unknown[]) => refreshBronze(...args) }));

import { changePrimaryEmail, normalizeEmail } from "@/lib/member-email";

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
  fetchWithAttachments.mockReset();
  dataset = new InMemoryDataset({
    members: [
      { id: ME, name: "Ada Example", email: "old@example.com", userId: USER, kajabiId: "kaj1" },
      { id: OTHER, name: "Grace Example", email: "taken@example.com", kajabiId: "kaj-grace" },
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

  it("explains that Kajabi already has another contact with the address, and changes nothing", async () => {
    updateContact.mockRejectedValue(new Error('Kajabi API error (422): {"errors":[{"status":"422","detail":"Email is already taken"}]}'));
    const result = await changePrimaryEmail({ repos, service: db, member: me({ kajabiId: "kaj1" }), address: "new@example.com" });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Kajabi already has a different contact with that email. Merge or delete that contact in Kajabi first, then try again.",
    });
    expect((await repos.authUsers.byId(USER))!.email).toBe("old@example.com");
    expect((await repos.members.byId(ME))!.email).toBe("old@example.com");
  });

  describe("when Kajabi already has another contact with the address", () => {
    const taken = () => updateContact.mockRejectedValue(new Error('Kajabi API error (422): {"errors":[{"detail":"Email is already taken"}]}'));
    const holder = (id: string) => {
      dataset.kajabiContacts.push({ kajabi_contact_id: id, email: "New@Example.com", name: "Dup", data: {}, imported_at: "2026-01-01T00:00:00Z" } as never);
    };
    const change = () => changePrimaryEmail({ repos, service: db, member: me({ kajabiId: "kaj1" }), address: "new@example.com" });
    const attached = (extra: Record<string, unknown>) => ({ id: "dup1", type: "contacts", attributes: {}, ...extra });

    it("names the contact and the member it is linked to, and never offers to delete it", async () => {
      taken();
      dataset.kajabiContacts.push({ kajabi_contact_id: "kaj-grace", email: "new@example.com", name: "Grace", data: {}, imported_at: "2026-01-01T00:00:00Z" } as never);

      const result = await change();

      expect(result).toMatchObject({
        ok: false,
        status: 409,
        kajabiConflict: { contactId: "kaj-grace", memberId: OTHER, memberName: "Grace Example", empty: false },
        error: expect.stringContaining("Kajabi contact kaj-grace already has that email and is linked to Grace Example here"),
      });
      expect(fetchWithAttachments).not.toHaveBeenCalled();
      expect((await repos.authUsers.byId(USER))!.email).toBe("old@example.com");
    });

    it("says an unlinked contact is empty only when Kajabi says nothing is attached", async () => {
      taken();
      holder("dup1");
      fetchWithAttachments.mockResolvedValue(attached({ relationships: { tags: { data: [] }, offers: { data: [] }, customer: { data: null } } }));

      expect(await change()).toMatchObject({
        status: 409,
        kajabiConflict: { contactId: "dup1", memberId: null, empty: true },
        error: expect.stringContaining("has nothing attached in Kajabi"),
      });
    });

    it("says what is attached to an unlinked contact that isn't empty", async () => {
      taken();
      holder("dup1");
      fetchWithAttachments.mockResolvedValue(
        attached({ links: { customer: "https://app.kajabi.com/api/v1/customers/1" }, relationships: { tags: { data: [{ id: "1" }, { id: "2" }] }, offers: { data: [{ id: "9" }] } } })
      );

      const result = await change();

      expect(result).toMatchObject({ status: 409, kajabiConflict: { contactId: "dup1", empty: false } });
      expect((result as { error: string }).error).toContain("a customer record, 2 tags, 1 offer");
      expect((result as { error: string }).error).toContain("merge it into this member's contact in Kajabi");
    });

    it("falls back to the general message when the contact can't be read or isn't in the Bronze copy", async () => {
      taken();
      expect(await change()).toEqual({
        ok: false,
        status: 409,
        error: "Kajabi already has a different contact with that email. Merge or delete that contact in Kajabi first, then try again.",
      });

      holder("dup1");
      fetchWithAttachments.mockRejectedValue(new Error("Kajabi is down"));
      expect(await change()).toMatchObject({ status: 409, kajabiConflict: { contactId: "dup1", empty: false }, error: expect.stringContaining("Merge or delete it in Kajabi first") });
    });
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
