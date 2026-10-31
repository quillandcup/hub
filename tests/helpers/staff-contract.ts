import { describe, it, expect, beforeEach } from "vitest";
import type { StaffRepository } from "@/lib/data/staff";

export type StaffContractContext = {
  repo: () => StaffRepository;
  /** Two members a staff row can be linked to. */
  members: readonly { id: string }[];
  /** Replaces the context's staff rows with these (emails are made unique per run); returns their ids in order. */
  seed: (staff: { name: string; role: "owner" | "staff" | "contractor"; hireDate?: string }[]) => Promise<string[]>;
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
  });
}
