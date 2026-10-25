import { describe, it, expect, beforeEach } from "vitest";
import type { BadgeRepository } from "@/lib/data/badges";

export type BadgeContractContext = {
  repo: () => BadgeRepository;
  /** Two members and two events the cases can use. */
  memberIds: readonly [string, string];
  events: readonly [{ id: string; title: string; slug: string }, { id: string; title: string; slug: string }];
  /** A name no other run has used, so keys and names never collide in a shared database. */
  unique: (label: string) => string;
  /** Hand over what the repository created, so the context removes it. */
  adopt: (created: { typeIds?: string[]; awardIds?: string[] }) => void;
  /** Start from no awards of the context's members. */
  reset: () => Promise<void>;
};

/** Behavior every `BadgeRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineBadgeContract(name: string, setup: () => BadgeContractContext) {
  describe(`${name} (BadgeRepository contract)`, () => {
    let ctx: BadgeContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.reset();
    });

    const newType = async (label: string, over: Partial<Parameters<BadgeRepository["createType"]>[0]> = {}) => {
      const result = await ctx.repo().createType({
        key: ctx.unique(label).toLowerCase().replace(/\s+/g, "_"),
        name: ctx.unique(label),
        description: null,
        icon: "🏅",
        category: "community",
        hasLevels: false,
        isAutomatic: false,
        eventId: null,
        programId: null,
        ...over,
      });
      if (!result.ok) throw new Error(`createType refused: ${result.reason}`);
      ctx.adopt({ typeIds: [result.badgeType.id] });
      return result.badgeType;
    };

    it("creates a badge type and finds it by id and by key", async () => {
      const made = await newType("Quill", { description: "For writers.", icon: "🪶", category: "milestone", hasLevels: true });

      expect(made).toMatchObject({ description: "For writers.", icon: "🪶", category: "milestone", has_levels: true, is_automatic: false, program_id: null, event_id: null });
      expect(await ctx.repo().typeById(made.id)).toMatchObject({ id: made.id, key: made.key, name: made.name });
      expect(await ctx.repo().typeByKey(made.key)).toMatchObject({ id: made.id });
      expect(await ctx.repo().typeById("00000000-0000-4000-8000-000000000000")).toBeNull();
      expect(await ctx.repo().typeByKey("no_such_badge_key")).toBeNull();
    });

    it("refuses a second badge type for an event that already has one", async () => {
      const [event] = ctx.events;
      await newType("Retreat", { eventId: event.id });

      const second = await ctx.repo().createType({
        key: ctx.unique("Other").toLowerCase().replace(/\s+/g, "_"), name: ctx.unique("Other"), description: null, icon: "🏅", category: "community",
        hasLevels: false, isAutomatic: false, eventId: event.id, programId: null,
      });

      expect(second).toEqual({ ok: false, reason: "event_taken" });
    });

    it("changes a badge type, and says when it is missing or another one owns the event", async () => {
      const [e1, e2] = ctx.events;
      const a = await newType("A", { eventId: e1.id });
      const b = await newType("B");
      const patch = { name: ctx.unique("Renamed"), description: "New", icon: "⭐", category: "milestone", hasLevels: true, eventId: null, programId: null };

      const changed = await ctx.repo().updateType(b.id, patch);
      const keepsFlag = await ctx.repo().updateType(b.id, { ...patch, isAutomatic: true });
      const taken = await ctx.repo().updateType(b.id, { ...patch, eventId: e1.id });

      expect(changed).toMatchObject({ ok: true, badgeType: { id: b.id, name: patch.name, description: "New", icon: "⭐", has_levels: true, is_automatic: false } });
      expect(keepsFlag).toMatchObject({ ok: true, badgeType: { is_automatic: true } });
      expect(taken).toEqual({ ok: false, reason: "event_taken" });
      expect(await ctx.repo().updateType("00000000-0000-4000-8000-000000000000", patch)).toEqual({ ok: false, reason: "not_found" });
      expect(await ctx.repo().updateType(a.id, { ...patch, eventId: e2.id })).toMatchObject({ ok: true, badgeType: { event_id: e2.id } });
    });

    it("lists badge types by category then name, with the event's slug", async () => {
      const [event] = ctx.events;
      const z = await newType("Zed", { category: "community" });
      const a = await newType("Ant", { category: "community", eventId: event.id });
      const w = await newType("Wren", { category: "special" });
      const ours = new Set([z.id, a.id, w.id]);

      const listed = (await ctx.repo().types()).filter((t) => ours.has(t.id));

      expect(listed.map((t) => t.id)).toEqual([a.id, z.id, w.id]);
      expect(listed[0].event_slug).toBe(event.slug);
      expect(listed[1].event_slug).toBeNull();
    });

    it("tells which badge types an admin can award by hand, which events are linked, and which badge an event has", async () => {
      const [e1, e2] = ctx.events;
      const manual = await newType("Manual");
      const automatic = await newType("Auto", { isAutomatic: true });
      const linked = await newType("Linked", { eventId: e1.id });

      const manualIds = (await ctx.repo().manualTypes()).map((t) => t.id);

      expect(manualIds).toContain(manual.id);
      expect(manualIds).not.toContain(automatic.id);
      expect(manualIds).not.toContain(linked.id);
      expect((await ctx.repo().linkedEventIds()).has(e1.id)).toBe(true);
      expect((await ctx.repo().linkedEventIds({ exceptTypeId: linked.id })).has(e1.id)).toBe(false);
      expect(await ctx.repo().typeForEvent(e1.id)).toMatchObject({ id: linked.id, name: linked.name });
      expect(await ctx.repo().typeForEvent(e2.id)).toBeNull();
    });

    it("replaces a badge type's levels, lowest first", async () => {
      const type = await newType("Leveled", { hasLevels: true });
      const other = await newType("Other levels", { hasLevels: true });
      await ctx.repo().replaceLevels(other.id, [{ level: 1, name: "Only", threshold: null }]);

      await ctx.repo().replaceLevels(type.id, [{ level: 2, name: "Silver", threshold: 10 }, { level: 1, name: "Bronze", threshold: 5 }]);
      await ctx.repo().replaceLevels(type.id, [{ level: 2, name: "Silver", threshold: 20 }, { level: 1, name: "Bronze", threshold: 5 }, { level: 3, name: "Gold", threshold: null }]);

      const mine = await ctx.repo().levelsOf(type.id);
      expect(mine.map((l) => [l.level, l.name, l.threshold])).toEqual([[1, "Bronze", 5], [2, "Silver", 20], [3, "Gold", null]]);
      expect((await ctx.repo().levelsOf(other.id)).map((l) => l.name)).toEqual(["Only"]); // untouched
      expect((await ctx.repo().levels()).filter((l) => l.badge_type_id === type.id)).toHaveLength(3);
      await ctx.repo().replaceLevels(type.id, []);
      expect(await ctx.repo().levelsOf(type.id)).toEqual([]);
    });

    it("awards a badge by hand and reads the awards back by member, by type, and with details", async () => {
      const [a, b] = ctx.memberIds;
      const type = await newType("Awardable", { icon: "🌟" });

      const first = await ctx.repo().award({ memberId: a, badgeTypeId: type.id, occurredAt: "2026-03-01", note: "Early", awardedBy: null });
      const second = await ctx.repo().award({ memberId: a, badgeTypeId: type.id, occurredAt: "2026-05-01", note: null, awardedBy: null });
      const theirs = await ctx.repo().award({ memberId: b, badgeTypeId: type.id, note: "Hello", awardedBy: null });
      ctx.adopt({ awardIds: [first.id, second.id, theirs.id] });

      expect(first).toMatchObject({ memberId: a, badgeTypeId: type.id, note: "Early", eventId: null });
      expect(first.occurredAt.slice(0, 10)).toBe("2026-03-01"); // a date: the time of day is not kept
      expect((await ctx.repo().awardsOf(a)).map((x) => x.note).sort()).toEqual([null, "Early"].sort());
      expect((await ctx.repo().awardsOfType(type.id)).map((x) => x.memberId).sort()).toEqual([a, a, b].sort());
      const detailed = await ctx.repo().awardsWithDetails(a);
      expect(detailed.map((d) => d.id)).toEqual([second.id, first.id]); // newest first
      expect(detailed[0]).toMatchObject({ badgeTypeName: type.name, badgeTypeIcon: "🌟", eventTitle: null, eventSlug: null });
      expect((await ctx.repo().awardCounts()).get(type.id)).toBe(3);
      expect(await ctx.repo().awardById(theirs.id)).toMatchObject({ id: theirs.id, memberId: b });
      expect(await ctx.repo().awardById("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("revokes an award", async () => {
      const [a] = ctx.memberIds;
      const type = await newType("Revocable");
      const award = await ctx.repo().award({ memberId: a, badgeTypeId: type.id, note: null, awardedBy: null });
      ctx.adopt({ awardIds: [award.id] });

      await ctx.repo().revoke(award.id);

      expect(await ctx.repo().awardById(award.id)).toBeNull();
      expect((await ctx.repo().awardCounts()).get(type.id) ?? 0).toBe(0);
    });

    it("deletes a badge type along with its levels and awards", async () => {
      const [a] = ctx.memberIds;
      const type = await newType("Doomed", { hasLevels: true });
      await ctx.repo().replaceLevels(type.id, [{ level: 1, name: "One", threshold: 1 }]);
      const award = await ctx.repo().award({ memberId: a, badgeTypeId: type.id, note: null, awardedBy: null });

      await ctx.repo().deleteType(type.id);

      expect(await ctx.repo().typeById(type.id)).toBeNull();
      expect(await ctx.repo().levelsOf(type.id)).toEqual([]);
      expect(await ctx.repo().awardById(award.id)).toBeNull();
    });
  });
}
