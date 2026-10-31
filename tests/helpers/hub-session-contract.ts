import { beforeEach, describe, expect, it } from "vitest";
import type { EventRepository } from "@/lib/data/events";
import type { HubSessionRepository } from "@/lib/data/hub-sessions";

export type HubSessionContractContext = {
  repo: () => HubSessionRepository;
  events: () => EventRepository;
  /** Makes an event stand on this prickle; returns the event id. */
  standEventOn: (prickleId: string) => Promise<string>;
  removeEvent: (eventId: string) => Promise<void>;
  /** The prickle row now, or null. */
  prickle: (prickleId: string) => Promise<{ source: string; hubSessionId: string | null; title: string | null; location: string | null; typeId: string | null; startTime: string } | null>;
  /** The id of the event-only prickle type a session without a type gets. */
  eventTypeId: () => Promise<string>;
  /** Makes a member who can host; returns the id. */
  member: () => Promise<string>;
};

const START = "2097-08-10T13:00:00Z";
const END = "2097-08-10T15:00:00Z";

/** Behavior every `HubSessionRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineHubSessionContract(name: string, setup: () => HubSessionContractContext) {
  describe(`${name} (HubSessionRepository contract)`, () => {
    let ctx: HubSessionContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("creates a session and projects it into a hub prickle of the event-only type", async () => {
      const made = await ctx.repo().create({ title: "Hub Gathering", startTime: START, endTime: END, location: "Lakehouse" });

      expect(made).toMatchObject({ title: "Hub Gathering", location: "Lakehouse", hostId: null, typeId: null });
      expect(made.prickleId).toBeTruthy();
      expect(await ctx.prickle(made.prickleId!)).toMatchObject({ source: "hub", hubSessionId: made.id, title: "Hub Gathering", location: "Lakehouse", typeId: await ctx.eventTypeId() });
      expect(await ctx.repo().byId(made.id)).toEqual(made);
      await ctx.repo().remove(made.id);
    });

    it("keeps the prickle's id when the session changes, and an event on it follows", async () => {
      const made = await ctx.repo().create({ title: "Before", startTime: START, endTime: END });
      const eventId = await ctx.standEventOn(made.prickleId!);

      const changed = await ctx.repo().update(made.id, { title: "After", hostName: "Pat Example", guestSpeaker: "Ada Example" });

      expect(changed.prickleId).toBe(made.prickleId);
      expect(await ctx.events().byId(eventId)).toMatchObject({ title: "After", host_name: "Pat Example", speakers: "Ada Example", starts_at: "2097-08-10", prickle_id: made.prickleId });
      await ctx.removeEvent(eventId);
      await ctx.repo().remove(made.id);
    });

    it("shows the host member's name for an event on a session with a host", async () => {
      const hostId = await ctx.member();
      const made = await ctx.repo().create({ title: "Hosted", startTime: START, endTime: END, hostId });
      const eventId = await ctx.standEventOn(made.prickleId!);

      expect((await ctx.events().byId(eventId))?.host_name).toBeTruthy();
      await ctx.removeEvent(eventId);
      await ctx.repo().remove(made.id);
    });

    it("refuses a session that ends before it starts, and a change that would", async () => {
      await expect(ctx.repo().create({ title: "Backwards", startTime: END, endTime: START })).rejects.toThrow();
      const made = await ctx.repo().create({ title: "Fine", startTime: START, endTime: END });

      await expect(ctx.repo().update(made.id, { endTime: "2097-08-10T12:00:00Z" })).rejects.toThrow();
      await ctx.repo().remove(made.id);
    });

    it("throws for a session that does not exist", async () => {
      expect(await ctx.repo().byId("hsess_AAAAAAAAAAA1")).toBeNull();
      await expect(ctx.repo().update("hsess_AAAAAAAAAAA1", { title: "Nope" })).rejects.toThrow();
    });

    it("deletes the session and its prickle, but not while an event stands on it", async () => {
      const made = await ctx.repo().create({ title: "Short lived", startTime: START, endTime: END });
      const eventId = await ctx.standEventOn(made.prickleId!);

      await expect(ctx.repo().remove(made.id)).rejects.toThrow();
      expect(await ctx.repo().byId(made.id)).not.toBeNull();

      await ctx.removeEvent(eventId);
      await ctx.repo().remove(made.id);

      expect(await ctx.repo().byId(made.id)).toBeNull();
      expect(await ctx.prickle(made.prickleId!)).toBeNull();
    });

    it("projecting again changes nothing", async () => {
      const made = await ctx.repo().create({ title: "Stable", startTime: START, endTime: END });

      await ctx.repo().project();
      await ctx.repo().project();

      expect((await ctx.repo().byId(made.id))?.prickleId).toBe(made.prickleId);
      await ctx.repo().remove(made.id);
    });
  });
}
