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
  /** Hand over prickles the repository created, so the context removes them with the rest. */
  adopt: (prickleIds: string[]) => void;
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

    it("finds the prickle running at an instant: started, not ended, the earliest first", async () => {
      const [early, , late] = await ctx.seed([
        { start: at(0), end: at(4) },
        { start: at(5), end: at(6) },
        { start: at(2), end: at(8) },
      ]);

      expect((await ctx.repo().inProgressAt(at(3)))?.id).toBe(early); // two overlap: the earlier start
      expect((await ctx.repo().inProgressAt(at(4)))?.id).toBe(late); // the first ended exactly now
      expect((await ctx.repo().inProgressAt(at(0)))?.id).toBe(early); // starting now counts
      expect(await ctx.repo().inProgressAt(at(9))).toBeNull();
    });

    it("counts how many prickles each member hosted before a moment, with zero for members who hosted none", async () => {
      await ctx.seed([
        { host: 0, start: at(0) },
        { host: 0, start: at(1) },
        { host: 0, start: at(10) },
        { host: 1, start: at(2) },
        { start: at(3) },
      ]);

      const counts = await ctx.repo().hostedCounts([ctx.hosts[0].id, ctx.hosts[1].id, "mbr_ZZZZZZZZZZZZ"], at(5));

      expect(counts.get(ctx.hosts[0].id)).toBe(2); // the one at 10 hasn't started
      expect(counts.get(ctx.hosts[1].id)).toBe(1);
      expect(counts.get("mbr_ZZZZZZZZZZZZ")).toBe(0);
      expect(await ctx.repo().hostedCounts([], at(5))).toEqual(new Map());
    });

    it("lists prickles of a type by its normalized name that are running or start within a window, oldest first, capped", async () => {
      const [over, running, soon, later, otherType] = await ctx.seed([
        { type: 0, start: at(0), end: at(1) },
        { type: 0, start: at(2), end: at(6) },
        { type: 0, start: at(7), end: at(8) },
        { type: 0, start: at(20), end: at(21) },
        { type: 1, start: at(3), end: at(4) },
      ]);
      const window = { normalizedName: ctx.types[0].normalizedName, from: at(5), to: at(10), limit: 10 };

      const found = await ctx.repo().ofTypeActiveBetween(window);
      const capped = await ctx.repo().ofTypeActiveBetween({ ...window, limit: 1 });

      expect(found.map((p) => p.id)).toEqual([running, soon]); // not the one that ended, the later one, or the other type
      expect(found[0].type).toEqual(ctx.types[0]);
      expect(capped.map((p) => p.id)).toEqual([running]);
      expect(await ctx.repo().ofTypeActiveBetween({ ...window, normalizedName: "no such type" })).toEqual([]);
      expect([over, later, otherType]).toHaveLength(3);
    });

    it("lists the host and start time of every hosted prickle, optionally one member's", async () => {
      await ctx.seed([
        { host: 0, start: at(0) },
        { host: 0, start: at(1) },
        { host: 1, start: at(2) },
        { start: at(3) },
      ]);

      const all = (await ctx.repo().hostedStartTimes()).filter((h) => [ctx.hosts[0].id, ctx.hosts[1].id].includes(h.hostId));
      const mine = await ctx.repo().hostedStartTimes({ hostId: ctx.hosts[0].id });

      expect(all.map((h) => h.hostId).sort()).toEqual([ctx.hosts[0].id, ctx.hosts[0].id, ctx.hosts[1].id].sort());
      expect(mine.map((h) => new Date(h.startTime).getTime()).sort()).toEqual([new Date(at(0)).getTime(), new Date(at(1)).getTime()]);
      expect(mine.every((h) => h.hostId === ctx.hosts[0].id)).toBe(true);
    });

    it("picks the next prickle from an instant, else the latest there is", async () => {
      await ctx.seed([{ start: at(0) }, { start: at(5) }, { start: at(9) }]);

      expect(new Date((await ctx.repo().nextOrMostRecent(at(3)))!.startTime)).toEqual(new Date(at(5)));
      expect(new Date((await ctx.repo().nextOrMostRecent(at(5)))!.startTime)).toEqual(new Date(at(5))); // starting exactly then counts
      // Nothing after: the latest there is (a shared database may hold later ones from elsewhere).
      expect(new Date((await ctx.repo().nextOrMostRecent("2999-01-01T00:00:00Z"))!.startTime).getTime()).toBeGreaterThanOrEqual(new Date(at(9)).getTime());
    });

    it("counts the members who have ever hosted", async () => {
      await ctx.seed([]);
      const before = await ctx.repo().distinctHostCount();

      await ctx.seed([{ host: 0, start: at(0) }, { host: 0, start: at(1) }, { host: 1, start: at(2) }, { start: at(3) }]);

      // The seeded hosts may already host elsewhere in a shared database, so at most two more.
      const after = await ctx.repo().distinctHostCount();
      expect(after).toBeGreaterThanOrEqual(before);
      expect(after).toBeLessThanOrEqual(before + 2);
      expect(after).toBeGreaterThanOrEqual(2);
    });

    it("lists the prickles running at the start of a window or starting within it, oldest first", async () => {
      const [over, running, soon, later] = await ctx.seed([
        { start: at(0), end: at(1) },
        { start: at(2), end: at(6) },
        { start: at(7), end: at(8) },
        { start: at(20), end: at(21) },
      ]);

      const found = (await ctx.repo().activeBetween({ from: at(5), to: at(10) })).map((p) => p.id);

      expect(found).toEqual([running, soon]);
      expect(found).not.toContain(over);
      expect(found).not.toContain(later);
    });

    it("finds a prickle type by its normalized name, or creates it once", async () => {
      await ctx.seed([]);
      const suffix = Math.random().toString(36).slice(2, 10);
      const normalizedName = `contract-new-${suffix}`;

      const first = await ctx.repo().findOrCreateType({ name: `Contract New Type ${suffix}`, normalizedName, description: "Made by the contract" });
      const again = await ctx.repo().findOrCreateType({ name: "Other Spelling", normalizedName });

      expect(again).toBe(first);
      const made = (await ctx.repo().types()).find((t) => t.id === first);
      expect(made).toMatchObject({ name: `Contract New Type ${suffix}`, normalizedName });
      expect(await ctx.repo().findOrCreateType({ name: ctx.types[0].name, normalizedName: ctx.types[0].normalizedName })).toBe(ctx.types[0].id);
    });

    it("creates prickles from the calendar, with their type and host", async () => {
      const ids = await ctx.repo().createCalendarPrickles([
        { typeId: ctx.types[0].id, hostId: ctx.hosts[0].id, description: "From the calendar", startTime: at(30), endTime: at(31) },
        { typeId: ctx.types[1].id, hostId: null, startTime: at(32), endTime: at(33) },
      ]);
      ctx.adopt(ids);

      const [first, second] = await ctx.repo().byIds(ids).then((found) => ids.map((id) => found.find((p) => p.id === id)!));
      expect(ids).toHaveLength(2);
      expect(first).toMatchObject({ source: "calendar", typeId: ctx.types[0].id, hostId: ctx.hosts[0].id });
      expect(new Date(first.endTime)).toEqual(new Date(at(31)));
      expect(second).toMatchObject({ source: "calendar", typeId: ctx.types[1].id, hostId: null });
      expect(await ctx.repo().createCalendarPrickles([])).toEqual([]);
    });

    it("hands one member's prickles to another", async () => {
      const [mine, theirs, hostless] = await ctx.seed([{ host: 0, start: at(40) }, { host: 1, start: at(41) }, { start: at(42) }]);

      await ctx.repo().reassignHost(ctx.hosts[0].id, ctx.hosts[1].id);

      const found = await ctx.repo().byIds([mine, theirs, hostless]);
      const hostOf = (id: string) => found.find((p) => p.id === id)?.hostId;
      expect(hostOf(mine)).toBe(ctx.hosts[1].id);
      expect(hostOf(theirs)).toBe(ctx.hosts[1].id);
      expect(hostOf(hostless)).toBeNull();
    });
  });
}
