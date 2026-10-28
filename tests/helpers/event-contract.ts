import { describe, it, expect, beforeEach } from "vitest";
import type { EventRepository } from "@/lib/data/events";

export type SeedEvent = { key: string; title: string; startsAt: string };

export type EventContractContext = {
  repo: () => EventRepository;
  /** Replaces the events this context created with these; returns each one's id by its key. */
  seed: (events: SeedEvent[]) => Promise<Record<string, string>>;
};

/** Behavior every `EventRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineEventContract(name: string, setup: () => EventContractContext) {
  describe(`${name} (EventRepository contract)`, () => {
    let ctx: EventContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists events for a picker, newest first", async () => {
      const ids = await ctx.seed([
        { key: "old", title: "Spring Retreat", startsAt: "2097-03-01T09:00:00Z" },
        { key: "new", title: "Autumn Retreat", startsAt: "2097-09-01T09:00:00Z" },
        { key: "mid", title: "Summer Workshop", startsAt: "2097-06-01T09:00:00Z" },
      ]);

      const ours = (await ctx.repo().choices()).filter((e) => Object.values(ids).includes(e.id));

      expect(ours.map((e) => [e.title, e.starts_at.slice(0, 10)])).toEqual([
        ["Autumn Retreat", "2097-09-01"],
        ["Summer Workshop", "2097-06-01"],
        ["Spring Retreat", "2097-03-01"],
      ]);
    });
  });
}
