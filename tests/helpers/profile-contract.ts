import { describe, it, expect, beforeEach } from "vitest";
import type { ProfileRepository } from "@/lib/data/profiles";

export type SeedUser = { key: string; email: string; role?: string; timezone?: string; secondary?: string };

export type ProfileContractContext = {
  repo: () => ProfileRepository;
  /** Replaces the users this context created with these (each with a profile); returns each one's auth user id by key. */
  seed: (users: SeedUser[]) => Promise<Record<string, string>>;
  /** A string no other run has used, to keep emails unique in a shared database. */
  unique: (label: string) => string;
};

/** Behavior every `ProfileRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineProfileContract(name: string, setup: () => ProfileContractContext) {
  describe(`${name} (ProfileRepository contract)`, () => {
    let ctx: ProfileContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const NONE = "00000000-0000-4000-8000-000000000000";
    const email = (label: string) => `${ctx.unique(label).replace(/\s+/g, "-").toLowerCase()}@example.test`;

    it("reads a user's profile, and nothing for someone without one", async () => {
      const ids = await ctx.seed([{ key: "a", email: email("ada"), role: "assistant", timezone: "America/Chicago", secondary: "Europe/London" }]);

      expect(await ctx.repo().byId(ids.a)).toMatchObject({ id: ids.a, role: "assistant", timezone_preference: "America/Chicago", secondary_timezone: "Europe/London" });
      expect(await ctx.repo().byId(NONE)).toBeNull();
    });

    it("says who is an admin, and says no when it can't tell", async () => {
      const ids = await ctx.seed([
        { key: "admin", email: email("admin"), role: "admin" },
        { key: "helper", email: email("helper"), role: "assistant" },
        { key: "member", email: email("member") },
      ]);

      expect(await ctx.repo().isAdmin(ids.admin)).toBe(true);
      expect(await ctx.repo().isAdmin(ids.helper)).toBe(false);
      expect(await ctx.repo().isAdmin(ids.member)).toBe(false);
      expect(await ctx.repo().isAdmin(NONE)).toBe(false);
    });

    it("lists the admins and assistants by email, and the admin ids", async () => {
      const tag = ctx.unique("staff").replace(/\s+/g, "-").toLowerCase();
      const ids = await ctx.seed([
        { key: "z", email: `${tag}-z@example.test`, role: "admin" },
        { key: "a", email: `${tag}-a@example.test`, role: "assistant" },
        { key: "m", email: `${tag}-m@example.test` },
      ]);

      const ours = (await ctx.repo().staff()).filter((p) => p.email.startsWith(tag));
      expect(ours).toEqual([
        { id: ids.a, email: `${tag}-a@example.test`, role: "assistant" },
        { id: ids.z, email: `${tag}-z@example.test`, role: "admin" },
      ]);

      const admins = await ctx.repo().adminIds();
      expect(admins).toContain(ids.z);
      expect(admins).not.toContain(ids.a);
      expect(admins).not.toContain(ids.m);
    });

    it("reads several users' profiles, and everyone's", async () => {
      const ids = await ctx.seed([
        { key: "a", email: email("one") },
        { key: "b", email: email("two") },
      ]);

      expect((await ctx.repo().byIds([ids.a, ids.b, ids.a, NONE])).map((p) => p.id).sort()).toEqual([ids.a, ids.b].sort());
      expect(await ctx.repo().byIds([])).toEqual([]);
      const everyone = (await ctx.repo().all()).map((p) => p.id);
      expect(everyone).toEqual(expect.arrayContaining([ids.a, ids.b]));
      expect([...everyone].sort()).toEqual(everyone); // by id
    });

    it("changes the role and the time zones", async () => {
      const ids = await ctx.seed([{ key: "a", email: email("changer") }]);

      await ctx.repo().setRole(ids.a, "admin");
      await ctx.repo().setTimezonePreference(ids.a, "Asia/Tokyo");
      await ctx.repo().setSecondaryTimezone(ids.a, "Europe/Paris");
      expect(await ctx.repo().byId(ids.a)).toMatchObject({ role: "admin", timezone_preference: "Asia/Tokyo", secondary_timezone: "Europe/Paris" });
      expect(await ctx.repo().isAdmin(ids.a)).toBe(true);

      await ctx.repo().setSecondaryTimezone(ids.a, null);
      expect((await ctx.repo().byId(ids.a))?.secondary_timezone).toBeNull();
    });

    it("records who left usage statistics, and who is back in", async () => {
      const ids = await ctx.seed([
        { key: "a", email: email("ada") },
        { key: "b", email: email("bea") },
        { key: "c", email: email("cat") },
      ]);
      const repo = ctx.repo();
      expect(await repo.analyticsOptedOut(ids.a)).toBe(false);
      expect(await repo.analyticsOptedOut(NONE)).toBe(false);

      await repo.setAnalyticsOptOut(ids.a, "2026-10-30T10:00:00.000Z");
      await repo.setAnalyticsOptOut(ids.b, "2026-10-30T11:00:00.000Z");
      expect(await repo.analyticsOptedOut(ids.a)).toBe(true);
      expect(await repo.analyticsOptedOutIds([ids.a, ids.b, ids.c, NONE])).toEqual(new Set([ids.a, ids.b]));
      expect(await repo.analyticsOptedOutIds([])).toEqual(new Set());

      await repo.setAnalyticsOptOut(ids.a, null);
      expect(await repo.analyticsOptedOut(ids.a)).toBe(false);
      expect(await repo.analyticsOptedOutIds([ids.a, ids.b])).toEqual(new Set([ids.b]));
    });
  });
}
