import { describe, it, expect, beforeEach } from "vitest";
import type { PrickleRepository, PrickleType } from "@/lib/data/prickles";

/** A seeded prickle, naming its type and host by position in the context's lists. */
export type PrickleSeed = { calendarEvent?: boolean; zoomMeetingUuid?: string; description?: string; guestSpeaker?: string; createdAt?: string; title?: string; type?: 0 | 1; host?: 0 | 1; start: string; end?: string; source?: "calendar" | "sheets" | "zoom" };

export type PrickleContractContext = {
  repo: () => PrickleRepository;
  /** The two prickle types and two hosts the seeds can point at. */
  types: readonly [PrickleType, PrickleType];
  hosts: readonly [{ id: string; name: string }, { id: string; name: string }];
  /** Replace the context's prickles with these; returns their ids in order. */
  seed: (prickles: PrickleSeed[]) => Promise<string[]>;
  /** Hand over prickles the repository created, so the context removes them with the rest. */
  adopt: (prickleIds: string[]) => void;
  /** Removes the vibe tags of the context's two hosts. */
  clearHostVibes: () => Promise<void>;
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

    it("finds the prickles made from calendar events by the calendar event ids", async () => {
      const [fromCalendar, alsoFromCalendar, hostOnly] = await ctx.seed([
        { calendarEvent: true, type: 0, start: at(0) },
        { calendarEvent: true, start: at(1) },
        { start: at(2) },
      ]);
      const [first, second] = await ctx.repo().byIds([fromCalendar, alsoFromCalendar]).then((found) => [fromCalendar, alsoFromCalendar].map((id) => found.find((p) => p.id === id)!));
      expect(first.calendarEventId).not.toBeNull();

      const found = await ctx.repo().byCalendarEventIds([first.calendarEventId!, "00000000-0000-4000-8000-000000000000"]);

      expect(found.map((p) => p.id)).toEqual([fromCalendar]);
      expect(found[0].type).toEqual(ctx.types[0]);
      expect((await ctx.repo().byCalendarEventIds([first.calendarEventId!, second.calendarEventId!])).map((p) => p.id).sort()).toEqual([fromCalendar, alsoFromCalendar].sort());
      expect(await ctx.repo().byCalendarEventIds([])).toEqual([]);
      expect(hostOnly).toBeTruthy();
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

      expect(types.filter((t) => ctx.types.some((c) => c.id === t.id)).sort((x, y) => x.id.localeCompare(y.id))).toMatchObject(
        [...ctx.types].sort((x, y) => x.id.localeCompare(y.id)),
      );
      expect(types.every((t) => Array.isArray(t.summaryAliases) && typeof t.namesGuestSpeaker === "boolean")).toBe(true);
    });

    it("reads one type by id, with its aliases and guest-speaker flag, and answers null for an unknown id", async () => {
      await ctx.seed([]);
      const found = await ctx.repo().typeById(ctx.types[0].id);

      expect(found).toMatchObject({ ...ctx.types[0], summaryAliases: [], namesGuestSpeaker: false });
      expect(await ctx.repo().typeById("prty_ZZZZZZZZZZZ9")).toBeNull();
    });

    it("lists the types that need a host by name, with just their id and name", async () => {
      await ctx.seed([]);
      const found = await ctx.repo().typesRequiringHost();

      expect(found).toContainEqual({ id: ctx.types[0].id, name: ctx.types[0].name }); // requires a host
      expect(found.map((t) => t.id)).not.toContain(ctx.types[1].id); // does not
      const names = found.map((t) => t.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it("finds a type by its normalized name, leaving out the one being edited", async () => {
      await ctx.seed([]);
      const [sprint, chat] = ctx.types;

      expect(await ctx.repo().typeIdByNormalizedName(sprint.normalizedName)).toBe(sprint.id);
      expect(await ctx.repo().typeIdByNormalizedName(sprint.normalizedName, { excludingId: chat.id })).toBe(sprint.id);
      expect(await ctx.repo().typeIdByNormalizedName(sprint.normalizedName, { excludingId: sprint.id })).toBeNull();
      expect(await ctx.repo().typeIdByNormalizedName("no-such-type-anywhere")).toBeNull();
    });

    it("creates a type, changes only the fields given, and hands a default host over", async () => {
      await ctx.seed([]);
      const suffix = Math.random().toString(36).slice(2, 10);
      const [ada, fern] = ctx.hosts;

      const created = await ctx.repo().createType({ name: `Made Type ${suffix}`, normalizedName: `made-type-${suffix}`, description: null, purpose: "social", listedInEvents: true });

      expect(created).toMatchObject({ name: `Made Type ${suffix}`, normalizedName: `made-type-${suffix}`, description: null, purpose: "social", listedInEvents: true, announcedPublicly: false, guestsAllowed: false, soloTaskFriendly: true, requiresHost: true, summaryAliases: [], namesGuestSpeaker: false });
      expect(await ctx.repo().typeById(created.id)).toEqual(created);

      await ctx.repo().updateType(created.id, { description: "A new kind", defaultHostId: ada.id, summaryAliases: ["made", "mt"], namesGuestSpeaker: true, requiresHost: true, soloTaskFriendly: true, announcedPublicly: true, guestsAllowed: true, purpose: undefined });
      expect(await ctx.repo().typeById(created.id)).toMatchObject({
        name: `Made Type ${suffix}`, // not given, so not changed
        purpose: "social",
        description: "A new kind",
        defaultHostId: ada.id,
        summaryAliases: ["made", "mt"],
        namesGuestSpeaker: true,
        requiresHost: true,
        soloTaskFriendly: true,
        announcedPublicly: true,
        guestsAllowed: true,
      });

      await ctx.repo().updateType(created.id, { name: `Renamed ${suffix}`, normalizedName: `renamed-${suffix}`, defaultHostId: null, guestsAllowed: false, announcedPublicly: false, listedInEvents: false });
      expect(await ctx.repo().typeById(created.id)).toMatchObject({ name: `Renamed ${suffix}`, normalizedName: `renamed-${suffix}`, defaultHostId: null, listedInEvents: false, description: "A new kind" });

      await ctx.repo().updateType(created.id, { defaultHostId: ada.id });
      await ctx.repo().reassignDefaultHost(ada.id, fern.id);
      expect((await ctx.repo().typeById(created.id))?.defaultHostId).toBe(fern.id);
      expect((await ctx.repo().typeById(ctx.types[0].id))?.defaultHostId ?? null).toBeNull();
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

    it("lists the types a member hosted since an instant, each once", async () => {
      await ctx.seed([
        { type: 0, host: 0, start: at(0) },
        { type: 0, host: 0, start: at(3) },
        { type: 1, host: 0, start: at(4) },
        { type: 1, host: 1, start: at(5) },
        { host: 0, start: at(6) },
      ]);

      const sorted = (rows: { typeId: string; typeName: string }[]) => [...rows].sort((a, b) => a.typeName.localeCompare(b.typeName));
      expect(sorted(await ctx.repo().hostedTypesSince(ctx.hosts[0].id, at(0)))).toEqual(
        sorted([{ typeId: ctx.types[0].id, typeName: ctx.types[0].name }, { typeId: ctx.types[1].id, typeName: ctx.types[1].name }])
      );
      expect(await ctx.repo().hostedTypesSince(ctx.hosts[0].id, at(3.5))).toEqual([{ typeId: ctx.types[1].id, typeName: ctx.types[1].name }]);
      expect(await ctx.repo().hostedTypesSince(ctx.hosts[1].id, at(6))).toEqual([]);
    });

    it("saves a host's vibe tag per type, changes it in place, and filters the tags by host and types", async () => {
      await ctx.seed([]);
      await ctx.clearHostVibes();
      const [ada, fern] = ctx.hosts;
      const [sprint, chat] = ctx.types;

      expect(await ctx.repo().hostVibes()).toEqual(expect.not.arrayContaining([expect.objectContaining({ host_id: ada.id })]));
      expect(await ctx.repo().hostVibeCount(ada.id)).toBe(0);

      await ctx.repo().saveHostVibe({ typeId: sprint.id, hostId: ada.id, vibe: "focused", notes: "quiet", updatedBy: null });
      await ctx.repo().saveHostVibe({ typeId: chat.id, hostId: ada.id, vibe: "chatty", notes: null, updatedBy: null });
      await ctx.repo().saveHostVibe({ typeId: sprint.id, hostId: fern.id, vibe: "balanced", notes: null, updatedBy: null });
      await ctx.repo().saveHostVibe({ typeId: sprint.id, hostId: ada.id, vibe: "chatty", notes: "livelier now", updatedBy: null });

      const tag = (host: string, type: string, vibe: string, notes: string | null) => ({ host_id: host, type_id: type, vibe, notes });
      const mine = (rows: { host_id: string; type_id: string; vibe: string; notes: string | null }[]) => rows.filter((r) => [ada.id, fern.id].includes(r.host_id));
      const byKey = (a: { host_id: string; type_id: string }, b: { host_id: string; type_id: string }) => (a.host_id + a.type_id).localeCompare(b.host_id + b.type_id);

      expect(mine(await ctx.repo().hostVibes()).sort(byKey)).toEqual(
        [tag(ada.id, sprint.id, "chatty", "livelier now"), tag(ada.id, chat.id, "chatty", null), tag(fern.id, sprint.id, "balanced", null)].sort(byKey)
      );
      expect((await ctx.repo().hostVibes({ hostId: ada.id })).sort(byKey)).toEqual([tag(ada.id, sprint.id, "chatty", "livelier now"), tag(ada.id, chat.id, "chatty", null)].sort(byKey));
      expect(await ctx.repo().hostVibes({ hostId: ada.id, typeIds: [chat.id] })).toEqual([tag(ada.id, chat.id, "chatty", null)]);
      expect(mine(await ctx.repo().hostVibes({ typeIds: [sprint.id] }))).toHaveLength(2);
      expect(await ctx.repo().hostVibes({ hostId: ada.id, typeIds: [] })).toEqual([]);
      expect(await ctx.repo().hostVibeCount(ada.id)).toBe(2);
      expect(await ctx.repo().hostVibeCount(fern.id)).toBe(1);
      await ctx.clearHostVibes();
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

    it("leaves out the prickle an event stands on (the Event type) from session lists, unless asked for", async () => {
      const [session, eventPrickle] = await ctx.seed([
        { start: at(1), end: at(5), title: "contract-session" },
        { start: at(0), end: at(4), title: "contract-session" }, // starts first, so it would win every "earliest" if it counted
      ]);
      const eventTypeId = await ctx.repo().findOrCreateType({ name: "Event", normalizedName: "event" });
      await ctx.repo().setType(eventPrickle, eventTypeId);
      const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

      expect(ids(await ctx.repo().startingBetween({ from: at(0), to: at(10) }))).toEqual([session]);
      expect(ids(await ctx.repo().startingBetween({ from: at(0), to: at(10), includeEventType: true }))).toEqual([eventPrickle, session]);
      expect(ids(await ctx.repo().activeBetween({ from: at(2), to: at(3) }))).toEqual([session]);
      expect((await ctx.repo().inProgressAt(at(2)))?.id).toBe(session);
      expect((await ctx.repo().nextOrMostRecent(at(-1)))?.id).toBe(session);
      expect(ids(await ctx.repo().search({ words: [{ text: "contract-session", hostIds: [] }], limit: 10, offset: 0 }))).toEqual([session]);
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

    it("lists prickles of types listed in Events that are running or start within a window, oldest first, capped", async () => {
      const [over, running, soon, later, otherType] = await ctx.seed([
        { type: 0, start: at(0), end: at(1) },
        { type: 0, start: at(2), end: at(6) },
        { type: 0, start: at(7), end: at(8) },
        { type: 0, start: at(20), end: at(21) },
        { type: 1, start: at(3), end: at(4) },
      ]);
      const window = { from: at(5), to: at(10), limit: 10 };

      const found = await ctx.repo().listedInEventsActiveBetween(window);
      const capped = await ctx.repo().listedInEventsActiveBetween({ ...window, limit: 1 });

      expect(found.map((p) => p.id)).toEqual([running, soon]); // not the one that ended, the later one, or the unlisted type
      expect(found[0].type).toEqual(ctx.types[0]);
      expect(capped.map((p) => p.id)).toEqual([running]);
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

    it("gives a prickle another type and leaves the others alone", async () => {
      const [changed, untouched] = await ctx.seed([{ type: 0, start: at(38) }, { type: 0, start: at(39) }]);

      await ctx.repo().setType(changed, ctx.types[1].id);

      const found = await ctx.repo().byIds([changed, untouched]);
      expect(found.find((p) => p.id === changed)?.typeId).toBe(ctx.types[1].id);
      expect(found.find((p) => p.id === untouched)?.typeId).toBe(ctx.types[0].id);
    });

    it("gives a prickle another host and leaves the others alone", async () => {
      const [changed, untouched] = await ctx.seed([{ host: 0, start: at(36) }, { host: 0, start: at(37) }]);

      await ctx.repo().setHost(changed, ctx.hosts[1].id);

      const found = await ctx.repo().byIds([changed, untouched]);
      expect(found.find((p) => p.id === changed)?.hostId).toBe(ctx.hosts[1].id);
      expect(found.find((p) => p.id === untouched)?.hostId).toBe(ctx.hosts[0].id);
    });

    it("sets a prickle's title, description and guest speaker: a field left out is kept, null empties it, others are untouched", async () => {
      const [changed, untouched] = await ctx.seed([
        { title: "Old title", description: "Old description", guestSpeaker: "Old Speaker", start: at(43) },
        { title: "Same title", start: at(44) },
      ]);

      await ctx.repo().setText(changed, { title: "New title", guestSpeaker: "Ada Example" });
      let found = await ctx.repo().byIds([changed, untouched]);
      expect(found.find((p) => p.id === changed)).toMatchObject({ title: "New title", description: "Old description", guestSpeaker: "Ada Example" });
      expect(found.find((p) => p.id === untouched)?.title).toBe("Same title");

      await ctx.repo().setText(changed, { description: null, guestSpeaker: null });
      found = await ctx.repo().byIds([changed]);
      expect(found[0]).toMatchObject({ title: "New title", description: null, guestSpeaker: null });

      await ctx.repo().setText(changed, {}); // nothing to change
      expect((await ctx.repo().byIds([changed]))[0].title).toBe("New title");
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

    it("lists everything from a start on when no end is given", async () => {
      const [, from, later] = await ctx.seed([{ start: at(0) }, { start: at(5) }, { start: at(500) }]);

      const found = (await ctx.repo().startingBetween({ from: at(1) })).map((p) => p.id);

      expect(found).toContain(from);
      expect(found).toContain(later);
      expect(found.indexOf(from)).toBeLessThan(found.indexOf(later));
      expect(await ctx.repo().startingBetween({ from: at(1), hostId: ctx.hosts[0].id })).toEqual([]);
    });

    it("searches prickles by their guest speaker, and every word still has to match", async () => {
      const suffix = Math.random().toString(36).slice(2, 8);
      const [spoken, other] = await ctx.seed([
        { start: at(70), guestSpeaker: `Dr Bailey Lang ${suffix}` },
        { start: at(71), guestSpeaker: `Someone Else ${suffix}` },
      ]);
      const mine = async (text: string) =>
        (await ctx.repo().search({ words: text.split(" ").map((t) => ({ text: t, hostIds: [] })), limit: 50, offset: 0, after: at(69), before: at(80) })).map((p) => p.id).filter((id) => [spoken, other].includes(id));

      expect(await mine(`bailey lang ${suffix}`)).toEqual([spoken]);
      expect(await mine(`bailey else ${suffix}`)).toEqual([]);
    });

    it("searches prickles by title, type name or the host's name, every word, newest first", async () => {
      const suffix = Math.random().toString(36).slice(2, 8);
      const [titled, byType, byHost, other] = await ctx.seed([
        { start: at(50), title: `Tiny Workshop ${suffix}` },
        { type: 0, start: at(51) },
        { host: 0, start: at(52) },
        { type: 1, start: at(53) },
      ]);
      const ids = [titled, byType, byHost, other];
      const mine = async (query: Partial<Parameters<ReturnType<typeof ctx.repo>["search"]>[0]>) =>
        (await ctx.repo().search({ words: [], limit: 50, offset: 0, after: at(49), before: at(60), ...query })).map((p) => p.id).filter((id) => ids.includes(id));

      expect(await mine({ words: [{ text: `workshop ${suffix}`, hostIds: [] }] })).toEqual([titled]); // by its own title
      expect(await mine({ words: [{ text: ctx.types[0].name, hostIds: [] }] })).toEqual([byType]); // by type name
      expect(await mine({ words: [{ text: "anything", hostIds: [ctx.hosts[0].id] }] })).toEqual([byHost]); // by a host the caller matched
      expect(await mine({ words: [{ text: ctx.types[1].name, hostIds: [] }, { text: "nonesuch", hostIds: [] }] })).toEqual([]); // every word must match
      expect(await mine({})).toEqual([other, byHost, byType, titled]); // newest first
      expect(await mine({ hostIds: [ctx.hosts[0].id] })).toEqual([byHost]);
      expect(await mine({ hostIds: [] })).toEqual([]);
      expect(await mine({ after: at(52), before: at(53) })).toEqual([byHost]); // [after, before)
      expect(await mine({ limit: 2, offset: 1 })).toEqual([byHost, byType]);
    });

    it("counts a source's prickles by whether their type takes a host and whether one is assigned", async () => {
      await ctx.seed([]);
      const before = await ctx.repo().hostCoverage("sheets");

      await ctx.seed([
        { type: 0, host: 0, start: at(60), source: "sheets" }, // type 0 takes a host (see the context)
        { type: 0, start: at(61), source: "sheets" },
        { type: 0, start: at(62), source: "sheets" },
        { type: 1, host: 1, start: at(63), source: "sheets" }, // type 1 doesn't
        { type: 1, start: at(64), source: "sheets" },
        { start: at(65), source: "sheets" }, // no type: only in the total
        { type: 0, host: 0, start: at(66) }, // another source
      ]);
      const after = await ctx.repo().hostCoverage("sheets");

      expect(after.total - before.total).toBe(6);
      expect(after.requiresHost.withHost - before.requiresHost.withHost).toBe(1);
      expect(after.requiresHost.withoutHost - before.requiresHost.withoutHost).toBe(2);
      expect(after.optionalHost.withHost - before.optionalHost.withHost).toBe(1);
      expect(after.optionalHost.withoutHost - before.optionalHost.withoutHost).toBe(1);
    });

    it("says when the newest prickle from a source was added", async () => {
      await ctx.seed([
        { start: at(70), source: "sheets", createdAt: "2097-06-01T10:00:00Z" },
        { start: at(71), source: "sheets", createdAt: "2097-07-01T10:00:00Z" },
      ]);

      const last = await ctx.repo().lastCreatedAt("sheets");

      expect(new Date(last!).getTime()).toBeGreaterThanOrEqual(new Date("2097-07-01T10:00:00Z").getTime());
      expect(await ctx.repo().lastCreatedAt("no-such-source")).toBeNull();
    });

    it("lists every prickle's time window and source, oldest first", async () => {
      const [first, second] = await ctx.seed([
        { start: at(81), end: at(82), source: "sheets" },
        { start: at(80), end: at(83) },
      ]);

      const windows = (await ctx.repo().timeWindows()).filter((w) => [first, second].includes(w.id));

      expect(windows.map((w) => w.id)).toEqual([second, first]);
      expect(windows[1]).toMatchObject({ source: "sheets", zoomMeetingUuid: null });
      expect(new Date(windows[0].endTime)).toEqual(new Date(at(83)));
    });

    it("lists the time windows of more than a thousand prickles", async () => {
      const ids = await ctx.seed(Array.from({ length: 1050 }, (_, i) => ({ start: at(100 + i / 100) })));

      const found = new Set((await ctx.repo().timeWindows()).map((w) => w.id));

      expect(ids.every((id) => found.has(id))).toBe(true);
    });

    it("reads a prickle's guest speaker, null when there is none", async () => {
      const [withSpeaker, without] = await ctx.seed([{ start: at(94), guestSpeaker: "Ellen Example" }, { start: at(95) }]);
      const found = await ctx.repo().byIds([withSpeaker, without]);
      expect(found.find((p) => p.id === withSpeaker)?.guestSpeaker).toBe("Ellen Example");
      expect(found.find((p) => p.id === without)?.guestSpeaker ?? null).toBeNull();
    });

    it("reads a prickle's description and its type's description", async () => {
      const suffix = Math.random().toString(36).slice(2, 8);
      const [withText, without] = await ctx.seed([{ start: at(90), description: "Bring a tiny idea." }, { start: at(91) }]);
      const typeId = await ctx.repo().findOrCreateType({ name: `Described Type ${suffix}`, normalizedName: `described-${suffix}`, description: "Timed writing in company." });
      ctx.adopt(await ctx.repo().createCalendarPrickles([{ typeId, hostId: null, description: "Made by a resolve", startTime: at(92), endTime: at(93) }]));

      const found = await ctx.repo().byIds([withText, without]);

      expect(found.find((p) => p.id === withText)?.description).toBe("Bring a tiny idea.");
      expect(found.find((p) => p.id === without)?.description ?? null).toBeNull();
      expect((await ctx.repo().types()).find((t) => t.id === typeId)?.description).toBe("Timed writing in company.");
    });

    it("finds the prickles of some Zoom meetings, newest first", async () => {
      const run = Math.random().toString(36).slice(2, 10);
      const [older, newer, other] = await ctx.seed([
        { start: at(110), source: "zoom", zoomMeetingUuid: `m1-${run}` },
        { start: at(111), source: "zoom", zoomMeetingUuid: `m2-${run}` },
        { start: at(112), source: "zoom", zoomMeetingUuid: `m3-${run}` },
      ]);

      const found = await ctx.repo().byZoomMeetings([`m1-${run}`, `m2-${run}`, "no-such-meeting"]);

      expect(found.map((p) => p.id)).toEqual([newer, older]);
      expect(found[0].zoomMeetingUuid).toBe(`m2-${run}`);
      expect(found.some((p) => p.id === other)).toBe(false);
      expect(await ctx.repo().byZoomMeetings([])).toEqual([]);
    });

    it("lists calendar prickles that overlap a window, strictly at both ends, oldest first", async () => {
      const [before, endsAtStart, inside, startsAtEnd, zoomOne] = await ctx.seed([
        { start: at(120), end: at(121) },
        { start: at(121), end: at(125) }, // ends exactly when the window starts: not overlapping
        { start: at(124), end: at(130) },
        { start: at(130), end: at(131) }, // starts exactly when the window ends: not overlapping
        { start: at(126), end: at(127), source: "sheets" }, // another source
      ]);
      const ids = [before, endsAtStart, inside, startsAtEnd, zoomOne];

      const found = (await ctx.repo().calendarOverlapping({ from: at(125), to: at(130) })).filter((p) => ids.includes(p.id));

      expect(found.map((p) => p.id)).toEqual([inside]);
      expect(found[0]).toMatchObject({ typeId: null });
      expect(new Date(found[0].startTime)).toEqual(new Date(at(124)));
    });

    it("lists the calendar prickles overlapping a window past a thousand", async () => {
      const ids = await ctx.seed(Array.from({ length: 1050 }, (_, i) => ({ start: at(140 + i / 100), end: at(141 + i / 100) })));

      const found = new Set((await ctx.repo().calendarOverlapping({ from: at(139), to: at(160) })).map((p) => p.id));

      expect(ids.every((id) => found.has(id))).toBe(true);
    });

    it("counts calendar prickles that have no host by their type, and lists a type's newest first", async () => {
      await ctx.seed([]);
      const before = await ctx.repo().hostlessCalendarCountsByType();

      const [oldest, , newest] = await ctx.seed([
        { type: 0, start: at(150) },
        { type: 0, host: 0, start: at(151) }, // has a host
        { type: 0, start: at(152) },
        { type: 1, start: at(153) },
        { start: at(154) }, // no type: not counted
        { type: 0, start: at(155), source: "sheets" }, // another source
      ]);
      const after = await ctx.repo().hostlessCalendarCountsByType();

      expect((after.get(ctx.types[0].id) ?? 0) - (before.get(ctx.types[0].id) ?? 0)).toBe(2);
      expect((after.get(ctx.types[1].id) ?? 0) - (before.get(ctx.types[1].id) ?? 0)).toBe(1);
      const listed = (await ctx.repo().hostlessCalendarOfType(ctx.types[0].id, 100)).map((p) => p.id);
      expect(listed.indexOf(newest)).toBeLessThan(listed.indexOf(oldest));
      expect((await ctx.repo().hostlessCalendarOfType(ctx.types[0].id, 1)).map((p) => p.id)).toHaveLength(1);
    });
  });
}
