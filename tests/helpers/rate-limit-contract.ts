import { describe, it, expect, beforeEach } from "vitest";
import type { RateLimitRepository } from "@/lib/data/rate-limit";

export type RateLimitContractContext = {
  repo: () => RateLimitRepository;
  /** A bucket name no other test uses. */
  unique: (label: string) => string;
};

/** Behavior every `RateLimitRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineRateLimitContract(name: string, setup: () => RateLimitContractContext) {
  describe(`${name} (RateLimitRepository contract)`, () => {
    let ctx: RateLimitContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("allows hits up to the limit and refuses the next", async () => {
      const bucket = ctx.unique("limit");
      expect(await ctx.repo().hit(bucket, 3600, 2)).toBe(true);
      expect(await ctx.repo().hit(bucket, 3600, 2)).toBe(true);
      expect(await ctx.repo().hit(bucket, 3600, 2)).toBe(false);
      expect(await ctx.repo().hit(bucket, 3600, 2)).toBe(false);
    });

    it("counts each bucket on its own", async () => {
      const [a, b] = [ctx.unique("a"), ctx.unique("b")];
      expect(await ctx.repo().hit(a, 3600, 1)).toBe(true);
      expect(await ctx.repo().hit(a, 3600, 1)).toBe(false);
      expect(await ctx.repo().hit(b, 3600, 1)).toBe(true);
    });
  });
}
