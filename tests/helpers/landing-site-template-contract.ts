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

    it("keeps a version at each publish, newest first, without the documents", async () => {
      expect(await ctx.repo().versions()).toEqual([]);
      await ctx.repo().saveDraft(site("first"), null);
      await ctx.repo().publish(null);
      await ctx.repo().saveDraft(site("second"), null);
      expect(await ctx.repo().versions()).toHaveLength(1);
      await ctx.repo().publish(null);
      const versions = await ctx.repo().versions();
      expect(versions).toHaveLength(2);
      expect(versions[0].created_at >= versions[1].created_at).toBe(true);
      expect(Object.keys(versions[0])).not.toContain("data");
      expect(await ctx.repo().versions(1)).toHaveLength(1);
    });

    it("keeps no version for a draft that is only saved, or for a publish that had nothing to publish", async () => {
      expect(await ctx.repo().publish(null)).toBe(false);
      await ctx.repo().saveDraft(site("wip"), null);
      expect(await ctx.repo().versions()).toEqual([]);
    });

    it("brings a version back into the draft only: the published copy and the versions stay as they were", async () => {
      await ctx.repo().saveDraft(site("old"), null);
      await ctx.repo().publish(null);
      await ctx.repo().saveDraft(site("new"), null);
      await ctx.repo().publish(null);
      const versions = await ctx.repo().versions();
      const old = versions[versions.length - 1];
      expect(await ctx.repo().restoreVersion(old.id, null)).toBe(true);
      const state = await ctx.repo().state();
      expect(state.draft.footer.text).toBe("old");
      expect(state.published?.footer.text).toBe("new");
      expect(await ctx.repo().versions()).toEqual(versions);
    });

    it("can't bring back a version that doesn't exist, and leaves the draft alone", async () => {
      await ctx.repo().saveDraft(site("wip"), null);
      expect(await ctx.repo().restoreVersion("lpstv_Missing000001", null)).toBe(false);
      expect((await ctx.repo().state()).draft.footer.text).toBe("wip");
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
