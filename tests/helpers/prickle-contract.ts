import { describe, it, expect, beforeEach } from "vitest";
import type { PrickleRepository, PrickleType } from "@/lib/data/prickles";

/** A seeded prickle, naming its type and host by position in the context's lists. */
export type PrickleSeed = { type?: 0 | 1; host?: 0 | 1; start: string; end?: string; source?: "calendar" | "sheets" };

export type PrickleContractContext = {
  repo: () => PrickleRepository;
  /** The two prickle types and two hosts the seeds can point at. */
  types: readonly [PrickleType, PrickleType];
  hosts: readonly [{ id: string; name: string }, { id: string; name: string }];
  /** Replace the context's prickles with these; returns their ids in order. */
  seed: (prickles: PrickleSeed[]) => Promise<string[]>;
};

const HOUR = 3_600_000;
const T0 = Date.parse("2097-03-01T15:00:00Z");
export const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString();

/** Behavior every `PrickleRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function definePrickleContract(name: string, setup: () => PrickleContractContext) {
  describe(`${name} (PrickleRepository contract)`, () => {
    let ctx: PrickleContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("joins the type and host onto a prickle, and leaves them null when there are none", async () => {
      const [withBoth, bare] = await ctx.seed([{ type: 0, host: 1, start: at(0) }, { start: at(1) }]);

      const found = await ctx.repo().byId(withBoth);
      expect(found).toMatchObject({
        id: withBoth,
        typeId: ctx.types[0].id,
        hostId: ctx.hosts[1].id,
        source: "calendar",
        type: ctx.types[0],
        host: { id: ctx.hosts[1].id, name: ctx.hosts[1].name },
      });
      expect(new Date(found!.startTime)).toEqual(new Date(at(0)));
      expect(await ctx.repo().byId(bare)).toMatchObject({ typeId: null, hostId: null, type: null, host: null });
      expect(await ctx.repo().byId("prkl_ZZZZZZZZZZZZ")).toBeNull();
    });

    it("returns only the prickles that exist among the ids asked for", async () => {
      const [a, , c] = await ctx.seed([{ start: at(0) }, { start: at(1) }, { start: at(2) }]);

      const found = await ctx.repo().byIds([a, c, "prkl_ZZZZZZZZZZZZ"]);

      expect(found.map((p) => p.id).sort()).toEqual([a, c].sort());
      expect(await ctx.repo().byIds([])).toEqual([]);
    });

    it("lists prickles that start in the window, oldest first, half-open unless told otherwise", async () => {
      const [, first, second, atEnd] = await ctx.seed([
        { start: at(0) },
        { start: at(5) },
        { start: at(8) },
        { start: at(10) },
        { start: at(11) },
      ]);

      const open = await ctx.repo().startingBetween({ from: at(1), to: at(10) });
      const closed = await ctx.repo().startingBetween({ from: at(1), to: at(10), inclusiveEnd: true });

      expect(open.map((p) => p.id)).toEqual([first, second]);
      expect(closed.map((p) => p.id)).toEqual([first, second, atEnd]);
    });

    it("keeps prickles that start together in one stable order", async () => {
      const ids = await ctx.seed([{ start: at(3) }, { start: at(3) }, { start: at(3) }]);

      const first = await ctx.repo().startingBetween({ from: at(0), to: at(4) });
      const second = await ctx.repo().startingBetween({ from: at(0), to: at(4) });

      expect(first.map((p) => p.id).sort()).toEqual([...ids].sort());
      expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id)); // paging relies on a total order
    });

    it("filters a window by type, and by no types at all", async () => {
      const [a, , c] = await ctx.seed([{ type: 0, start: at(0) }, { type: 1, start: at(1) }, { type: 0, start: at(2) }]);

      const found = await ctx.repo().startingBetween({ from: at(0), to: at(5), typeIds: [ctx.types[0].id] });

      expect(found.map((p) => p.id)).toEqual([a, c]);
      expect(found[0].type).toEqual(ctx.types[0]);
      expect(await ctx.repo().startingBetween({ from: at(0), to: at(5), typeIds: [] })).toEqual([]);
    });

    it("filters a window to the prickles one member hosts", async () => {
      const [, mine, , alsoMine] = await ctx.seed([
        { host: 1, start: at(0) },
        { host: 0, start: at(1) },
        { start: at(2) },
        { host: 0, start: at(3) },
      ]);

      const found = await ctx.repo().startingBetween({ from: at(0), to: at(5), hostId: ctx.hosts[0].id });

      expect(found.map((p) => p.id)).toEqual([mine, alsoMine]);
    });

    it("lists the prickle types", async () => {
      await ctx.seed([]);

      const types = await ctx.repo().types();

      expect(types.filter((t) => ctx.types.some((c) => c.id === t.id)).sort((x, y) => x.id.localeCompare(y.id))).toEqual(
        [...ctx.types].sort((x, y) => x.id.localeCompare(y.id)),
      );
    });

    it("counts what a member hosts and what came from a source", async () => {
      await ctx.seed([]);
      const calendarBefore = await ctx.repo().countBySource("calendar");

      await ctx.seed([
        { host: 0, start: at(0) },
        { host: 0, start: at(1), source: "sheets" },
        { host: 1, start: at(2) },
        { start: at(3) },
      ]);

      expect(await ctx.repo().countHostedBy(ctx.hosts[0].id)).toBe(2);
      expect(await ctx.repo().countHostedBy(ctx.hosts[1].id)).toBe(1);
      expect(await ctx.repo().countHostedBy(ctx.hosts[0].id, { since: at(1) })).toBe(1); // the one starting at(1), not at(0)
      expect(await ctx.repo().countBySource("calendar")).toBe(calendarBefore + 3);
    });

    it("pages through more than a thousand prickles", async () => {
      const ids = await ctx.seed(Array.from({ length: 1050 }, (_, i) => ({ start: at(i / 100) })));

      const found = await ctx.repo().startingBetween({ from: at(-1), to: at(100) });

      expect(found.map((p) => p.id).sort()).toEqual([...ids].sort());
    });
  });
}
