import { describe, it, expect, beforeEach } from "vitest";
import type { MemberRepository } from "@/lib/data/members";

/** A seeded member; `user` points at one of the context's two auth users. */
export type MemberSeedRecord = {
  name: string;
  displayName?: string;
  status?: string;
  user?: 0 | 1;
  staffRole?: string;
  firstJoinedAt?: string;
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

    it("lists members' identities by id, optionally one status", async () => {
      const [ada, fern, gale] = await ctx.seed([
        { name: "Ada Example", displayName: "Penny Quill" },
        { name: "Fern Example", status: "cancelled" },
        { name: "Gale Example" },
      ]);
      const ours = new Set([ada, fern, gale]);

      const everyone = (await ctx.repo().identities()).filter((m) => ours.has(m.id));
      const active = (await ctx.repo().identities({ status: "active" })).filter((m) => ours.has(m.id));

      expect(everyone.map((m) => m.id)).toEqual([ada, fern, gale].sort());
      expect(everyone.find((m) => m.id === ada)).toEqual({
        id: ada,
        name: "Ada Example",
        displayName: "Penny Quill",
        email: ctx.emailOf(ada),
      });
      expect(everyone.find((m) => m.id === fern)?.displayName).toBeNull();
      expect(active.map((m) => m.id)).toEqual([ada, gale].sort());
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

    it("counts members by status", async () => {
      await ctx.seed([]);
      const before = await ctx.repo().countByStatus("on_hiatus");

      await ctx.seed([{ name: "Ada Example", status: "on_hiatus" }, { name: "Fern Example", status: "on_hiatus" }, { name: "Gale Example" }]);

      expect(await ctx.repo().countByStatus("on_hiatus")).toBe(before + 2);
    });
  });
}
