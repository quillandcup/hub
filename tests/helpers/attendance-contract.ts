import { describe, it, expect, beforeEach } from "vitest";
import type { AttendanceRepository } from "@/lib/data/attendance";

/** A seeded record, naming members and prickles by position in the context's id lists. */
export type SeedRecord = { member: 0 | 1 | 2; prickle: 0 | 1 | 2; join: string; leave?: string };

export type AttendanceContractContext = {
  memberIds: readonly [string, string, string];
  prickleIds: readonly [string, string, string];
  /** The repository under test, over exactly the records passed to the last `seed`. */
  repo: () => AttendanceRepository;
  /** Replace all records for the context's members and prickles with these. */
  seed: (records: SeedRecord[]) => Promise<void>;
};

const HOUR = 3_600_000;
const T0 = Date.parse("2026-09-01T15:00:00Z");
const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString();

/**
 * Behavior every `AttendanceRepository` must have. Run against the in-memory twin (unit) and the
 * Supabase one (db) so they can't drift apart: callers are tested against the first, the second is
 * proven to match it.
 */
export function defineAttendanceContract(name: string, setup: () => AttendanceContractContext) {
  describe(`${name} (AttendanceRepository contract)`, () => {
    let ctx: AttendanceContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("counts a prickle once however often the member left and rejoined", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0), leave: at(0.5) },
        { member: 0, prickle: 0, join: at(1), leave: at(2) },
        { member: 0, prickle: 1, join: at(30) },
      ]);

      expect(await ctx.repo().attendedPrickleIds(ctx.memberIds[0])).toEqual(new Set([ctx.prickleIds[0], ctx.prickleIds[1]]));
      expect(await ctx.repo().countForMember(ctx.memberIds[0])).toBe(3); // records, not prickles
      expect(await ctx.repo().countForMember(ctx.memberIds[1])).toBe(0);
    });

    it("lists distinct prickles per member", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 0, join: at(1) },
        { member: 1, prickle: 0, join: at(0) },
        { member: 1, prickle: 2, join: at(50) },
      ]);

      const byMember = await ctx.repo().attendedPrickleIdsByMember();

      expect(byMember.get(ctx.memberIds[0])).toEqual(new Set([ctx.prickleIds[0]]));
      expect(byMember.get(ctx.memberIds[1])).toEqual(new Set([ctx.prickleIds[0], ctx.prickleIds[2]]));
      expect(byMember.has(ctx.memberIds[2])).toBe(false);
    });

    it("returns one entry per record for the prickles asked about, and nothing for none", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 0, join: at(1) },
        { member: 1, prickle: 1, join: at(30) },
        { member: 2, prickle: 2, join: at(50) },
      ]);

      const links = await ctx.repo().forPrickles([ctx.prickleIds[0], ctx.prickleIds[1]]);

      expect(links).toHaveLength(3);
      expect(links.filter((l) => l.memberId === ctx.memberIds[0] && l.prickleId === ctx.prickleIds[0])).toHaveLength(2);
      expect(links).toContainEqual({ memberId: ctx.memberIds[1], prickleId: ctx.prickleIds[1], joinTime: expect.any(String) });
      expect(links.map((l) => new Date(l.joinTime).getTime()).sort()).toEqual([at(0), at(1), at(30)].map((t) => Date.parse(t)));
      expect(await ctx.repo().forPrickles([])).toEqual([]);
    });

    it("lists every record, including ones for prickles nobody asked about", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 1, prickle: 2, join: at(50) },
      ]);

      const mine = (await ctx.repo().list()).filter((l) => ctx.memberIds.includes(l.memberId));

      expect(mine.map((l) => [l.memberId, l.prickleId])).toEqual(
        expect.arrayContaining([
          [ctx.memberIds[0], ctx.prickleIds[0]],
          [ctx.memberIds[1], ctx.prickleIds[2]],
        ]),
      );
      expect(mine).toHaveLength(2);
    });

    it("tells which of the prickles one member attended, and when they first joined each", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(1) },
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 2, join: at(50) },
        { member: 1, prickle: 1, join: at(30) },
      ]);
      const ids = [ctx.prickleIds[0], ctx.prickleIds[1]];

      expect(await ctx.repo().attendedAmong(ctx.memberIds[0], ids)).toEqual(new Set([ctx.prickleIds[0]]));
      const earliest = await ctx.repo().earliestJoinByPrickle(ctx.memberIds[0], ids);
      expect([...earliest.keys()]).toEqual([ctx.prickleIds[0]]);
      expect(new Date(earliest.get(ctx.prickleIds[0])!)).toEqual(new Date(at(0)));
      expect(await ctx.repo().attendedAmong(ctx.memberIds[0], [])).toEqual(new Set());
    });

    it("returns records that began in a window, inclusive at both ends", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0), leave: at(1) },
        { member: 1, prickle: 0, join: at(5), leave: at(7) },
        { member: 2, prickle: 0, join: at(10), leave: at(11) },
        { member: 2, prickle: 1, join: at(30) },
      ]);

      const spans = (await ctx.repo().joinedBetween(at(0), at(10))).filter((s) => ctx.memberIds.includes(s.memberId));

      expect(spans.map((s) => s.memberId).sort()).toEqual([...ctx.memberIds].sort());
      const second = spans.find((s) => s.memberId === ctx.memberIds[1])!;
      expect(new Date(second.leaveTime)).toEqual(new Date(at(7)));
    });

    it("says which members attended anything", async () => {
      await ctx.seed([
        { member: 1, prickle: 0, join: at(0) },
        { member: 1, prickle: 1, join: at(30) },
      ]);

      expect(await ctx.repo().membersWhoAttended(ctx.memberIds.slice())).toEqual(new Set([ctx.memberIds[1]]));
      expect(await ctx.repo().membersWhoAttended([])).toEqual(new Set());
    });

    it("keeps each member's latest join, and omits members who never attended", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 1, join: at(80) },
        { member: 0, prickle: 2, join: at(30) },
        { member: 1, prickle: 0, join: at(5) },
      ]);

      const last = await ctx.repo().lastJoinByMember(ctx.memberIds.slice());

      expect(last.get(ctx.memberIds[0])).toEqual(new Date(at(80)));
      expect(last.get(ctx.memberIds[1])).toEqual(new Date(at(5)));
      expect(last.has(ctx.memberIds[2])).toBe(false);
    });

    it("finds the earliest join, or null", async () => {
      await ctx.seed([
        { member: 0, prickle: 1, join: at(30) },
        { member: 0, prickle: 0, join: at(2) },
      ]);

      expect(new Date((await ctx.repo().firstJoinTime(ctx.memberIds[0]))!)).toEqual(new Date(at(2)));
      expect(await ctx.repo().firstJoinTime(ctx.memberIds[2])).toBeNull();
    });

    it("moves every record to the other member", async () => {
      await ctx.seed([
        { member: 0, prickle: 0, join: at(0) },
        { member: 0, prickle: 1, join: at(30) },
        { member: 1, prickle: 0, join: at(0) },
      ]);

      await ctx.repo().reassign(ctx.memberIds[0], ctx.memberIds[2]);

      expect(await ctx.repo().countForMember(ctx.memberIds[0])).toBe(0);
      expect(await ctx.repo().countForMember(ctx.memberIds[2])).toBe(2);
      expect(await ctx.repo().countForMember(ctx.memberIds[1])).toBe(1);
    });

    it("pages through more than a thousand records", async () => {
      await ctx.seed(Array.from({ length: 1050 }, (_, i) => ({ member: 0 as const, prickle: 0 as const, join: at(i / 60) })));

      expect(await ctx.repo().forPrickles([ctx.prickleIds[0]])).toHaveLength(1050);
      expect(await ctx.repo().countForMember(ctx.memberIds[0])).toBe(1050);
      expect((await ctx.repo().attendedPrickleIdsByMember()).get(ctx.memberIds[0])).toEqual(new Set([ctx.prickleIds[0]]));
    });
  });
}
