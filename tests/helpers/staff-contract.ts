import { describe, it, expect, beforeEach } from "vitest";
import type { StaffRepository } from "@/lib/data/staff";

export type StaffContractContext = {
  repo: () => StaffRepository;
  /** Five members: staff rows can be linked to them, and they can sign in as accounts. */
  members: readonly { id: string }[];
  /** Replaces the context's staff rows with these (emails are made unique per run); returns their ids in order. */
  seed: (staff: { name: string; role: "owner" | "staff" | "contractor"; hireDate?: string }[]) => Promise<string[]>;
  /** Replaces the context's sign-in accounts with these: `members[memberIndex]` signs in as an account with this role. */
  seedAccounts: (accounts: { memberIndex: number; role: string }[]) => Promise<void>;
};

/** Behavior every `StaffRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineStaffContract(name: string, setup: () => StaffContractContext) {
  describe(`${name} (StaffRepository contract)`, () => {
    let ctx: StaffContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists every staff row with its columns", async () => {
      const [ada, bo] = await ctx.seed([
        { name: "Ada Example", role: "owner", hireDate: "2020-05-01" },
        { name: "Bo Example", role: "contractor" },
      ]);

      const rows = await ctx.repo().all();
      const ours = rows.filter((r) => r.id === ada || r.id === bo);
      expect(ours).toHaveLength(2);
      expect(ours.find((r) => r.id === ada)).toMatchObject({ name: "Ada Example", role: "owner", hire_date: "2020-05-01", member_id: null });
      expect(ours.find((r) => r.id === bo)).toMatchObject({ name: "Bo Example", role: "contractor", hire_date: null });
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    });

    it("links staff rows to members, relinks them and clears the link, leaving other rows alone", async () => {
      const [ada, bo, cy] = await ctx.seed([
        { name: "Ada Example", role: "owner" },
        { name: "Bo Example", role: "staff" },
        { name: "Cy Example", role: "staff" },
      ]);
      const repo = ctx.repo();
      const memberOf = async (id: string) => (await repo.all()).find((r) => r.id === id)?.member_id;

      await repo.linkMembers([]);
      await repo.linkMembers([
        { id: ada, member_id: ctx.members[0].id },
        { id: bo, member_id: ctx.members[1].id },
      ]);
      expect([await memberOf(ada), await memberOf(bo), await memberOf(cy)]).toEqual([ctx.members[0].id, ctx.members[1].id, null]);

      await repo.linkMembers([
        { id: ada, member_id: null },
        { id: bo, member_id: ctx.members[0].id },
      ]);
      expect([await memberOf(ada), await memberOf(bo), await memberOf(cy)]).toEqual([null, ctx.members[0].id, null]);
    });

    it("memberIds: the one definition of a staff member", async () => {
      const [ada] = await ctx.seed([{ name: "Ada Example", role: "staff" }]);
      const repo = ctx.repo();
      // members[0] is linked in the staff roster, [1] signs in as an admin, [2] as a community manager, [3] as an assistant, [4] as a plain member.
      await repo.linkMembers([{ id: ada, member_id: ctx.members[0].id }]);
      await ctx.seedAccounts([
        { memberIndex: 1, role: "admin" },
        { memberIndex: 2, role: "community_manager" },
        { memberIndex: 3, role: "assistant" },
        { memberIndex: 4, role: "member" },
      ]);

      const staff = await repo.memberIds();
      expect(ctx.members.map((m) => staff.has(m.id))).toEqual([true, true, true, true, false]);

      // The link cleared and the accounts back to members: nobody of ours is staff.
      await ctx.seedAccounts([{ memberIndex: 1, role: "member" }]);
      await repo.linkMembers([{ id: ada, member_id: null }]);
      const after = await repo.memberIds();
      expect(ctx.members.map((m) => after.has(m.id))).toEqual([false, false, false, false, false]);
    });
  });
}
