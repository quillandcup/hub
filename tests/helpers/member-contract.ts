import { createRepos } from "@/lib/data/repos";
import { describe, it, expect, beforeEach } from "vitest";
import type { MemberRepository } from "@/lib/data/members";

/** A seeded member; `user` points at one of the context's two auth users. */
export type MemberSeedRecord = {
  name: string;
  kajabiId?: string;
  displayName?: string;
  status?: string;
  user?: 0 | 1;
  staffRole?: string;
  firstJoinedAt?: string;
  stripeCustomerId?: string;
  bio?: string;
  instagramUrl?: string;
  birthday?: [month: number, day: number];
  totalActiveMonths?: number;
  /** Name aliases (nicknames, pen names); a Supabase run suffixes them, since an alias is unique across members. */
  aliases?: { alias: string; active?: boolean }[];
};

export type MemberContractContext = {
  repo: () => MemberRepository;
  /** Two Supabase Auth users a seeded member can sign in as, and an auth user id no member has. */
  authUserIds: readonly [string, string];
  unusedUserId: string;
  /** Replace the context's members with these; returns their ids in order. */
  seed: (members: MemberSeedRecord[]) => Promise<string[]>;
  /** The email a seeded member was given, by id. */
  emailOf: (id: string) => string;
};

/** Behavior every `MemberRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineMemberContract(name: string, setup: () => MemberContractContext) {
  describe(`${name} (MemberRepository contract)`, () => {
    let ctx: MemberContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists members' identities in a stable order, optionally one status", async () => {
      const [ada, fern, gale] = await ctx.seed([
        { name: "Ada Example", displayName: "Penny Quill" },
        { name: "Fern Example", status: "cancelled" },
        { name: "Gale Example" },
      ]);
      const ours = new Set([ada, fern, gale]);

      const everyone = (await ctx.repo().identities()).filter((m) => ours.has(m.id));
      const active = (await ctx.repo().identities({ status: "active" })).filter((m) => ours.has(m.id));

      // Which order is the database's collation; what paging needs is that it is the same every time.
      expect(everyone.map((m) => m.id).sort()).toEqual([ada, fern, gale].sort());
      const again = (await ctx.repo().identities()).filter((m) => ours.has(m.id));
      expect(again.map((m) => m.id)).toEqual(everyone.map((m) => m.id));
      expect(everyone.find((m) => m.id === ada)).toEqual({
        id: ada,
        name: "Ada Example",
        displayName: "Penny Quill",
        email: ctx.emailOf(ada),
      });
      expect(everyone.find((m) => m.id === fern)?.displayName).toBeNull();
      expect(active.map((m) => m.id).sort()).toEqual([ada, gale].sort());
    });

    it("lists full member records by id or by name, optionally one status, in a stable order", async () => {
      const [zed, amy, bea] = await ctx.seed([
        { name: "Zed Example", kajabiId: "kaj-1" },
        { name: "Amy Example", status: "cancelled" },
        { name: "Bea Example" },
      ]);
      const ours = new Set([zed, amy, bea]);
      const mine = async (options?: Parameters<ReturnType<typeof ctx.repo>["list"]>[0]) =>
        (await ctx.repo().list(options)).filter((m) => ours.has(m.id));

      const byName = await mine({ orderBy: "name" });
      const byId = await mine();
      const active = await mine({ status: "active", orderBy: "name" });

      expect(byName.map((m) => m.name)).toEqual(["Amy Example", "Bea Example", "Zed Example"]);
      expect(byId.map((m) => m.id).sort()).toEqual([zed, amy, bea].sort());
      expect((await mine()).map((m) => m.id)).toEqual(byId.map((m) => m.id));
      expect(active.map((m) => m.name)).toEqual(["Bea Example", "Zed Example"]);
      expect(byName.find((m) => m.id === zed)?.kajabiId).toMatch(/^kaj-1/);
      expect(byName.find((m) => m.id === amy)?.kajabiId).toBeNull();
      expect(byName.find((m) => m.id === zed)).toMatchObject({ status: "active", stripeCustomerId: null });
    });

    it("finds members by email, and counts them all", async () => {
      const [ada, fern] = await ctx.seed([{ name: "Ada Example" }, { name: "Fern Example" }, { name: "Gale Example" }]);

      const found = await ctx.repo().byEmails([ctx.emailOf(ada), ctx.emailOf(fern), "nobody@example.test"]);

      expect(found.map((m) => m.id).sort()).toEqual([ada, fern].sort());
      expect(await ctx.repo().byEmails([])).toEqual([]);
      expect(await ctx.repo().count()).toBeGreaterThanOrEqual(3);
    });

    it("pages through more than a thousand members", async () => {
      const ids = await ctx.seed(Array.from({ length: 1050 }, (_, i) => ({ name: `Bulk Member ${i}` })));

      const found = new Set((await ctx.repo().identities()).map((m) => m.id));

      expect(ids.every((id) => found.has(id))).toBe(true);
    });

    it("finds a member's record by id, and null for one that doesn't exist", async () => {
      const [ada] = await ctx.seed([{ name: "Ada Example", status: "on_hiatus", user: 0, staffRole: "admin", firstJoinedAt: "2025-03-04" }]);

      expect(await ctx.repo().byId(ada)).toMatchObject({
        id: ada,
        name: "Ada Example",
        displayName: null,
        email: ctx.emailOf(ada),
        status: "on_hiatus",
        userId: ctx.authUserIds[0],
        staffRole: "admin",
      });
      expect((await ctx.repo().byId(ada))?.firstJoinedAt).toMatch(/^2025-03-04/);
      expect(await ctx.repo().byId("mbr_ZZZZZZZZZZZZ")).toBeNull();
    });

    it("returns only the members that exist among the ids asked for", async () => {
      const [ada, , gale] = await ctx.seed([{ name: "Ada Example" }, { name: "Fern Example" }, { name: "Gale Example" }]);

      const found = await ctx.repo().byIds([ada, gale, "mbr_ZZZZZZZZZZZZ"]);

      expect(found.map((m) => m.id).sort()).toEqual([ada, gale].sort());
      expect(await ctx.repo().byIds([])).toEqual([]);
    });

    it("finds the member who signs in as an auth user", async () => {
      const [, fern] = await ctx.seed([{ name: "Ada Example" }, { name: "Fern Example", user: 1 }]);

      expect((await ctx.repo().byUserId(ctx.authUserIds[1]))?.id).toBe(fern);
      expect(await ctx.repo().byUserId(ctx.unusedUserId)).toBeNull();
    });

    it("reads a member's profile and identity settings", async () => {
      const [ada, fern] = await ctx.seed([
        { name: "Ada Example", displayName: "Penny Quill", kajabiId: "kaj-9", bio: "Writes at dawn.", instagramUrl: "https://instagram.com/ada", birthday: [3, 14] },
        { name: "Fern Example" },
      ]);

      const profile = await ctx.repo().profile(ada);

      expect(profile).toMatchObject({
        id: ada,
        name: "Ada Example",
        displayName: "Penny Quill",
        email: ctx.emailOf(ada),
        bio: "Writes at dawn.",
        instagramUrl: "https://instagram.com/ada",
        facebookUrl: null,
        twitterUrl: null,
        birthdayMonth: 3,
        birthdayDay: 14,
        selfServiceNameChangedAt: null,
      });
      expect(profile?.kajabiId).toMatch(/^kaj-9/);
      expect(await ctx.repo().profile(fern)).toMatchObject({ bio: null, birthdayMonth: null, birthdayDay: null });
      expect(await ctx.repo().profile("mbr_ZZZZZZZZZZZZ")).toBeNull();
    });

    it("searches names and emails: every word, any case, with wildcards typed as plain characters", async () => {
      const [ada, fern, gale] = await ctx.seed([
        { name: "Zyxel Ada Quill" },
        { name: "Zyxel Fern Moss", status: "cancelled" },
        { name: "Zyxel Gale 100%" },
      ]);
      const ours = new Set([ada, fern, gale]);
      const found = async (query: Parameters<ReturnType<typeof ctx.repo>["search"]>[0]) =>
        (await ctx.repo().search(query)).filter((m) => ours.has(m.id)).map((m) => m.id);

      expect(await found({ words: ["zyxel"] })).toEqual([ada, fern, gale]); // by name
      expect(await found({ words: ["ZYXEL", "fern"] })).toEqual([fern]); // every word
      expect(await found({ words: ["zyxel", "nobody"] })).toEqual([]);
      expect(await found({ words: ["zyxel"], status: "active" })).toEqual([ada, gale]);
      expect(await found({ words: ["100%"] })).toEqual([gale]);
      expect(await found({ words: ["z_xel"] })).toEqual([]); // _ is not a wildcard
      expect(await found({ words: [ctx.emailOf(ada).toUpperCase()] })).toEqual([ada]); // by email, any case
    });

    it("searches display names as well as legal names", async () => {
      const [ada, fern] = await ctx.seed([
        { name: "Zyxel Ada Quill", displayName: "Penny Zyxelpen" },
        { name: "Zyxel Fern Moss" },
      ]);
      const found = async (word: string) => (await ctx.repo().search({ words: [word] })).map((m) => m.id).filter((id) => [ada, fern].includes(id));

      expect(await found("zyxelpen")).toEqual([ada]); // display name only
      expect(await found("PENNY")).toEqual([ada]);
      expect(await found("quill")).toEqual([ada]); // legal name still works
      expect(await found("zyxel")).toEqual([ada, fern]);
    });

    it("searches a member's active aliases, and not a switched-off one", async () => {
      const [ada, fern] = await ctx.seed([
        { name: "Zyxel Ada Quill", aliases: [{ alias: "Qzvnick Byron" }, { alias: "Qzvretired Name", active: false }] },
        { name: "Zyxel Fern Moss" },
      ]);
      const found = async (...words: string[]) => (await ctx.repo().search({ words })).map((m) => m.id).filter((id) => [ada, fern].includes(id));

      expect(await found("qzvnick")).toEqual([ada]);
      expect(await found("QZVNICK", "zyxel")).toEqual([ada]); // every word: alias for one, legal name for the other
      expect(await found("qzvnick", "fern")).toEqual([]);
      expect(await found("qzvretired")).toEqual([]);
    });

    it("says which alias made a member match, only when nothing shown for them did", async () => {
      const [ada] = await ctx.seed([{ name: "Zyxel Ada Quill", aliases: [{ alias: "Qzvnick Byron" }] }]);
      const hit = async (...words: string[]) => (await ctx.repo().search({ words })).find((m) => m.id === ada);

      expect((await hit("qzvnick"))?.matchedAlias).toMatch(/^Qzvnick Byron/);
      expect((await hit("qzvnick", "zyxel"))?.matchedAlias).toMatch(/^Qzvnick Byron/);
      expect((await hit("zyxel"))?.matchedAlias).toBeNull(); // the name matched
      expect((await hit("byron", "ada"))?.matchedAlias).toMatch(/^Qzvnick Byron/);
    });

    it("matches an email exactly or by what it contains, ignoring case", async () => {
      const [ada, fern] = await ctx.seed([{ name: "Ada Example" }, { name: "Fern Example" }]);
      const found = async (query: Parameters<ReturnType<typeof ctx.repo>["search"]>[0]) =>
        (await ctx.repo().search(query)).map((m) => m.id).filter((id) => [ada, fern].includes(id));

      expect(await found({ emailEquals: ctx.emailOf(ada).toUpperCase() })).toEqual([ada]);
      expect(await found({ emailEquals: ctx.emailOf(ada).slice(0, -3) })).toEqual([]); // not a prefix match
      expect(await found({ emailContains: ctx.emailOf(fern).slice(2, -2).toUpperCase() })).toEqual([fern]);
    });

    it("pages a search by name", async () => {
      const ids = await ctx.seed([{ name: "Qwv Cleo" }, { name: "Qwv Abe" }, { name: "Qwv Bea" }]);

      const first = await ctx.repo().search({ words: ["qwv"], limit: 2 });
      const rest = await ctx.repo().search({ words: ["qwv"], limit: 2, offset: 2 });

      expect(first.map((m) => m.name)).toEqual(["Qwv Abe", "Qwv Bea"]);
      expect(rest.map((m) => m.name)).toEqual(["Qwv Cleo"]);
      expect(ids).toHaveLength(3);
    });

    it("says when Kajabi processing last touched a Kajabi member", async () => {
      const startedAt = Date.now() - 60_000;
      await ctx.seed([{ name: "Ada Example", kajabiId: "kaj-1" }]);

      const last = await ctx.repo().lastKajabiProcessedAt();

      expect(last).not.toBeNull();
      expect(new Date(last!).getTime()).toBeGreaterThanOrEqual(startedAt);
    });

    it("counts members of a status with no Stripe customer", async () => {
      await ctx.seed([]);
      const before = await ctx.repo().countWithoutStripeCustomer("on_hiatus");

      await ctx.seed([
        { name: "Ada Example", status: "on_hiatus" },
        { name: "Fern Example", status: "on_hiatus", stripeCustomerId: "cus_1" },
        { name: "Gale Example" },
      ]);

      expect(await ctx.repo().countWithoutStripeCustomer("on_hiatus")).toBe(before + 1);
    });

    it("finds a member by exact email", async () => {
      const [ada] = await ctx.seed([{ name: "Ada Example" }, { name: "Fern Example" }]);

      expect((await ctx.repo().byEmail(ctx.emailOf(ada)))?.id).toBe(ada);
      expect(await ctx.repo().byEmail("nobody@example.test")).toBeNull();
    });

    it("maps auth users to members and members to auth users, with null for no account", async () => {
      const [ada, fern, gale] = await ctx.seed([
        { name: "Ada Example", user: 0 },
        { name: "Fern Example", user: 1 },
        { name: "Gale Example" },
      ]);

      const byUser = await ctx.repo().idsByUserId([...ctx.authUserIds, ctx.unusedUserId]);
      const byMember = await ctx.repo().userIdsByMemberId([ada, fern, gale, "mbr_ZZZZZZZZZZZZ"]);

      expect(byUser).toEqual(new Map([[ctx.authUserIds[0], ada], [ctx.authUserIds[1], fern]]));
      expect(byMember).toEqual(new Map<string, string | null>([[ada, ctx.authUserIds[0]], [fern, ctx.authUserIds[1]], [gale, null]]));
      expect(await ctx.repo().idsByUserId([])).toEqual(new Map());
    });

    it("counts members for every status at once", async () => {
      await ctx.seed([]);
      const before = await ctx.repo().countsByStatus();

      await ctx.seed([{ name: "Ada Example", status: "on_hiatus" }, { name: "Fern Example", status: "on_hiatus" }, { name: "Gale Example" }]);
      const after = await ctx.repo().countsByStatus();

      expect(after.get("on_hiatus")).toBe((before.get("on_hiatus") ?? 0) + 2);
      expect(after.get("active")).toBe((before.get("active") ?? 0) + 1);
    });

    it("counts members by status", async () => {
      await ctx.seed([]);
      const before = await ctx.repo().countByStatus("on_hiatus");

      await ctx.seed([{ name: "Ada Example", status: "on_hiatus" }, { name: "Fern Example", status: "on_hiatus" }, { name: "Gale Example" }]);

      expect(await ctx.repo().countByStatus("on_hiatus")).toBe(before + 2);
    });

    it("creates a member and deletes one", async () => {
      await ctx.seed([]);
      const email = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

      const id = await ctx.repo().create({ name: "Hope Example", email, joinedAt: "2026-02-03", status: "cancelled", source: "kajabi" });

      expect(await ctx.repo().byId(id)).toMatchObject({ id, name: "Hope Example", email, status: "cancelled", source: "kajabi" });
      await ctx.repo().delete(id);
      expect(await ctx.repo().byId(id)).toBeNull();
    });

    it("sets names, stamping the self-service change only when asked", async () => {
      const [ada] = await ctx.seed([{ name: "Ada Example", displayName: "Penny Quill" }]);

      expect(await ctx.repo().setName(ada, "Ada Renamed")).toBe(true);
      expect((await ctx.repo().profile(ada))?.selfServiceNameChangedAt).toBeNull();
      expect(await ctx.repo().setName(ada, "Ada Selfmade", { selfService: true })).toBe(true);
      expect(await ctx.repo().profile(ada)).toMatchObject({ name: "Ada Selfmade", displayName: "Penny Quill" });
      expect((await ctx.repo().profile(ada))?.selfServiceNameChangedAt).not.toBeNull();
      expect(await ctx.repo().setName(ada, "Ada Final", { displayName: "Ada Selfmade" })).toBe(true);
      expect(await ctx.repo().byId(ada)).toMatchObject({ name: "Ada Final", displayName: "Ada Selfmade" });
      expect(await ctx.repo().setName("mbr_ZZZZZZZZZZZZ", "Nobody")).toBe(false);
    });

    it("sets and clears display names, clearing by name only when it matches", async () => {
      const [ada] = await ctx.seed([{ name: "Ada Example" }]);

      expect(await ctx.repo().setDisplayName(ada, "Penny Quill")).toBe(true);
      await ctx.repo().clearDisplayNameIfEquals(ada, "Someone Else");
      expect((await ctx.repo().byId(ada))?.displayName).toBe("Penny Quill");
      await ctx.repo().clearDisplayNameIfEquals(ada, "Penny Quill");
      expect((await ctx.repo().byId(ada))?.displayName).toBeNull();
      await ctx.repo().setDisplayName(ada, "Penny Quill");
      expect(await ctx.repo().setDisplayName(ada, null)).toBe(true);
      expect((await ctx.repo().byId(ada))?.displayName).toBeNull();
      expect(await ctx.repo().setDisplayName("mbr_ZZZZZZZZZZZZ", "X")).toBe(false);
    });

    it("sets a birthday", async () => {
      const [ada] = await ctx.seed([{ name: "Ada Example" }]);

      expect(await ctx.repo().setBirthday(ada, 7, 21)).toBe(true);
      expect(await ctx.repo().profile(ada)).toMatchObject({ birthdayMonth: 7, birthdayDay: 21 });
      expect(await ctx.repo().setBirthday("mbr_ZZZZZZZZZZZZ", 7, 21)).toBe(false);
    });

    it("changes an email unless another member has it", async () => {
      const [ada, fern] = await ctx.seed([{ name: "Ada Example" }, { name: "Fern Example" }]);
      const fresh = `fresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

      expect(await ctx.repo().setEmail(ada, fresh)).toEqual({ ok: true });
      expect((await ctx.repo().byId(ada))?.email).toBe(fresh);
      expect(await ctx.repo().setEmail(fern, fresh)).toEqual({ ok: false, reason: "taken" });
      expect((await ctx.repo().byId(fern))?.email).toBe(ctx.emailOf(fern));
    });

    it("sets a status", async () => {
      const [ada] = await ctx.seed([{ name: "Ada Example" }]);

      await ctx.repo().setStatus(ada, "cancelled");

      expect((await ctx.repo().byId(ada))?.status).toBe("cancelled");
    });

    it("links and unlinks auth users", async () => {
      const [ada, fern, gale] = await ctx.seed([
        { name: "Ada Example" },
        { name: "Fern Example", user: 1 },
        { name: "Gale Example" },
      ]);

      await ctx.repo().linkAuthUser(ada, ctx.authUserIds[0], { onlyIfUnlinked: true });
      expect((await ctx.repo().byId(ada))?.userId).toBe(ctx.authUserIds[0]);
      await ctx.repo().unlinkAuthUser(ctx.authUserIds[0]);
      expect((await ctx.repo().byId(ada))?.userId).toBeNull();

      await ctx.repo().linkAuthUser(fern, ctx.authUserIds[0], { onlyIfUnlinked: true });
      expect((await ctx.repo().byId(fern))?.userId).toBe(ctx.authUserIds[1]); // already linked: left alone

      await ctx.repo().linkAuthUserByEmail(ctx.emailOf(gale), ctx.authUserIds[0]);
      expect((await ctx.repo().byId(gale))?.userId).toBe(ctx.authUserIds[0]);
      await ctx.repo().linkAuthUserByEmail(ctx.emailOf(fern), ctx.authUserIds[0]); // has an account: left alone
      expect((await ctx.repo().byId(fern))?.userId).toBe(ctx.authUserIds[1]);
    });

    it("copies external ids onto a member, only the ones given", async () => {
      const [ada] = await ctx.seed([{ name: "Ada Example", kajabiId: "kaj-keep" }]);
      const before = await ctx.repo().byId(ada);

      await ctx.repo().setExternalIds(ada, {});
      await ctx.repo().setExternalIds(ada, { stripeCustomerId: "cus_merged", userId: ctx.authUserIds[1] });

      expect(await ctx.repo().byId(ada)).toMatchObject({ kajabiId: before?.kajabiId, stripeCustomerId: "cus_merged", userId: ctx.authUserIds[1] });
    });

    it("reads what the admin member page shows, and null for no such member", async () => {
      const [ada] = await ctx.seed([
        { name: "Ada Example", displayName: "Penny Quill", status: "on_hiatus", kajabiId: "kaj-3", stripeCustomerId: "cus_3", firstJoinedAt: "2025-03-04", totalActiveMonths: 7 },
      ]);

      const view = await ctx.repo().adminView(ada);

      expect(view).toMatchObject({
        id: ada,
        name: "Ada Example",
        displayName: "Penny Quill",
        email: ctx.emailOf(ada),
        status: "on_hiatus",
        mostRecentJoinedAt: null,
        totalActiveMonths: 7,
      });
      expect(view?.kajabiId).toMatch(/^kaj-3/);
      expect(view?.stripeCustomerId).toMatch(/^cus_3/);
      expect(view?.firstJoinedAt).toMatch(/^2025-03-04/);
      expect(await ctx.repo().adminView("mbr_ZZZZZZZZZZZZ")).toBeNull();
    });
  });
}
