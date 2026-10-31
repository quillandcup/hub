import { describe, it, expect, beforeEach } from "vitest";
import type { OutreachRepository } from "@/lib/data/outreach";

export type OutreachContractContext = {
  repo: () => OutreachRepository;
  /** Three members: "Ada Example", "Bo Example" and "Cy Example". */
  members: readonly { id: string }[];
  /** An auth user id (what `updated_by` and `touched_by` point at). */
  userId: string;
  /** A member id nothing has. */
  missingMemberId: string;
  /** Removes everything stored for the three members. */
  clear: () => Promise<void>;
};

/** Behavior every `OutreachRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineOutreachContract(name: string, setup: () => OutreachContractContext) {
  describe(`${name} (OutreachRepository contract)`, () => {
    let ctx: OutreachContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo, cy] = [0, 1, 2];
    const id = (i: number) => ctx.members[i].id;

    it("rates a lead, rerates it, and lists the rated leads", async () => {
      const repo = ctx.repo();
      expect(await repo.leadStatuses()).not.toContainEqual(expect.objectContaining({ member_id: id(ada) }));

      const warm = await repo.setLeadStatus(id(ada), "warm", ctx.userId);
      expect(warm).toMatchObject({ member_id: id(ada), status: "warm", updated_by: ctx.userId });
      await repo.setLeadStatus(id(bo), "hot", null);
      const hot = await repo.setLeadStatus(id(ada), "hot", null);
      expect(hot).toMatchObject({ member_id: id(ada), status: "hot", updated_by: null, created_at: warm.created_at });

      const ours = (await repo.leadStatuses()).filter((l) => [id(ada), id(bo)].includes(l.member_id));
      expect(ours.map((l) => [l.member_id, l.status]).sort()).toEqual([[id(ada), "hot"], [id(bo), "hot"]].sort());
      expect(Object.keys(ours[0]).sort()).toEqual(["member_id", "status", "updated_at"]);
      const ids = (await repo.leadStatuses()).map((l) => l.member_id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("refuses to rate, or log a touch for, a member that does not exist", async () => {
      await expect(ctx.repo().setLeadStatus(ctx.missingMemberId, "hot", null)).rejects.toThrow();
      await expect(ctx.repo().logTouch(ctx.missingMemberId, null)).rejects.toThrow();
    });

    it("logs touches and finds when each member was last touched", async () => {
      const repo = ctx.repo();
      expect(await repo.lastTouchByMember([])).toEqual(new Map());
      expect(await repo.lastTouchByMember([id(ada)])).toEqual(new Map());

      const first = await repo.logTouch(id(ada), ctx.userId);
      expect(first).toMatchObject({ member_id: id(ada), touched_by: ctx.userId });
      expect(first.id).toEqual(expect.any(String));
      const second = await repo.logTouch(id(ada), null);
      expect(second.touched_by).toBeNull();
      const bos = await repo.logTouch(id(bo), null);

      const last = await repo.lastTouchByMember([id(ada), id(bo), id(cy), id(ada)]);
      expect(last).toEqual(
        new Map([
          [id(ada), second.touched_at],
          [id(bo), bos.touched_at],
        ]),
      );
      expect(second.touched_at >= first.touched_at).toBe(true);

      // More ids than fit one request (ids are chunked).
      const many = [id(bo), ...Array.from({ length: 250 }, (_, i) => `mbr_Z${String(i).padStart(11, "Z")}`)];
      expect(await repo.lastTouchByMember(many)).toEqual(new Map([[id(bo), bos.touched_at]]));
    });

    it("lists when touches happened since an instant, oldest first", async () => {
      const repo = ctx.repo();
      const before = new Date(Date.now() - 60_000).toISOString();
      const a = await repo.logTouch(id(ada), null);
      const b = await repo.logTouch(id(bo), null);

      const since = await repo.touchTimesSince(before);
      expect(since).toEqual(expect.arrayContaining([a.touched_at, b.touched_at]));
      expect(since.indexOf(a.touched_at)).toBeLessThanOrEqual(since.indexOf(b.touched_at));
      expect(since).toEqual([...since].sort());
      expect(await repo.touchTimesSince(new Date(Date.now() + 3_600_000).toISOString())).toEqual([]);
    });
  });
}
