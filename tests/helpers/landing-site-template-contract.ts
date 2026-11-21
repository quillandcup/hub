import { describe, it, expect, beforeEach } from "vitest";
import type { LandingSiteTemplateRepository } from "@/lib/data/landing-site-template";
import { EMPTY_SITE_TEMPLATE, normalizeSiteTemplate, type SiteTemplate } from "@/lib/landing/site-template";

export type LandingSiteTemplateContractContext = { repo: () => LandingSiteTemplateRepository; reset: () => Promise<void> };

const site = (text: string): SiteTemplate => normalizeSiteTemplate({ header: { show: true, items: [{ id: "a", type: "cta", label: text, href: "/join" }] }, footer: { show: true, text } });

/** Behavior every `LandingSiteTemplateRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineLandingSiteTemplateContract(name: string, setup: () => LandingSiteTemplateContractContext) {
  describe(`${name} (LandingSiteTemplateRepository contract)`, () => {
    let ctx: LandingSiteTemplateContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.reset();
    });

    it("starts empty: an empty draft, nothing published", async () => {
      expect(await ctx.repo().state()).toEqual({ draft: EMPTY_SITE_TEMPLATE, published: null, publishedAt: null, updatedAt: null });
      expect(await ctx.repo().published()).toBeNull();
      expect(await ctx.repo().publish(null)).toBe(false);
      expect(await ctx.repo().resetDraftToPublished(null)).toBe(false);
    });

    it("keeps one row however often the draft is saved, and never serves the draft to visitors", async () => {
      await ctx.repo().saveDraft(site("one"), null);
      await ctx.repo().saveDraft(site("two"), null);
      const state = await ctx.repo().state();
      expect(state.draft.footer.text).toBe("two");
      expect(state.published).toBeNull();
      expect(await ctx.repo().published()).toBeNull();
    });

    it("publishes the draft, and a later draft stays unpublished until it is published", async () => {
      await ctx.repo().saveDraft(site("first"), null);
      expect(await ctx.repo().publish(null)).toBe(true);
      await ctx.repo().saveDraft(site("second"), null);
      expect((await ctx.repo().published())?.footer.text).toBe("first");
      const state = await ctx.repo().state();
      expect(state.draft.footer.text).toBe("second");
      expect(state.publishedAt).toEqual(expect.any(String));
      await ctx.repo().publish(null);
      expect((await ctx.repo().published())?.footer.text).toBe("second");
    });

    it("resets the draft to the published copy", async () => {
      await ctx.repo().saveDraft(site("live"), null);
      await ctx.repo().publish(null);
      await ctx.repo().saveDraft(site("wip"), null);
      expect(await ctx.repo().resetDraftToPublished(null)).toBe(true);
      expect((await ctx.repo().state()).draft.footer.text).toBe("live");
    });
  });
}
