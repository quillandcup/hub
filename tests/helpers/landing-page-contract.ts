import { describe, it, expect, beforeEach } from "vitest";
import { LandingPageSlugTakenError, type LandingPageRepository } from "@/lib/data/landing-pages";
import { normalizeLandingData, type LandingData } from "@/lib/landing/data";

export type LandingPageContractContext = {
  repo: () => LandingPageRepository;
  /** An address no other test or run uses. */
  unique: (label: string) => string;
};

const doc = (text: string): LandingData => ({ content: [{ type: "Heading", props: { id: "h1", text } }], root: { props: {} } });

/** Behavior every `LandingPageRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineLandingPageContract(name: string, setup: () => LandingPageContractContext) {
  describe(`${name} (LandingPageRepository contract)`, () => {
    let ctx: LandingPageContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("creates a draft with an empty document and finds it by address", async () => {
      const slug = ctx.unique("new");
      const page = await ctx.repo().create({ title: "A page", slug, createdBy: null });

      expect(page).toMatchObject({ slug, title: "A page", status: "draft", published_data: null, deleted_at: null });
      expect(page.id).toMatch(/^lpg_/);
      expect(page.draft_data).toEqual({ content: [], root: {} });
      expect((await ctx.repo().bySlug(slug))?.id).toBe(page.id);
      expect(await ctx.repo().bySlug(ctx.unique("nothing"))).toBeNull();
    });

    it("refuses an address another live page has, and frees it when that page is deleted", async () => {
      const slug = ctx.unique("taken");
      const first = await ctx.repo().create({ title: "One", slug, createdBy: null });

      await expect(ctx.repo().create({ title: "Two", slug, createdBy: null })).rejects.toBeInstanceOf(LandingPageSlugTakenError);

      expect(await ctx.repo().remove(first.id, null)).toBe(true);
      const again = await ctx.repo().create({ title: "Two", slug, createdBy: null });
      expect(again.id).not.toBe(first.id);
    });

    it("autosaves the draft without touching what is published", async () => {
      const slug = ctx.unique("draft");
      const page = await ctx.repo().create({ title: "Draft", slug, data: doc("first"), createdBy: null });
      await ctx.repo().publish(page.id);

      const savedAt = await ctx.repo().saveDraft(page.id, doc("second"), null);

      expect(savedAt).toEqual(expect.any(String));
      const after = await ctx.repo().bySlug(slug);
      expect(after?.draft_data).toEqual(doc("second"));
      expect(after?.published_data).toEqual(doc("first"));
      expect((await ctx.repo().published(slug))?.data).toEqual(normalizeLandingData(doc("first")));
      expect(await ctx.repo().saveDraft(`lpg_${"A".repeat(12)}`, doc("x"), null)).toBeNull();
    });

    it("shows a signed-out visitor only a published page", async () => {
      const slug = ctx.unique("public");
      const page = await ctx.repo().create({ title: "Public", slug, data: doc("hello"), createdBy: null });
      expect(await ctx.repo().published(slug)).toBeNull();

      const published = await ctx.repo().publish(page.id);
      expect(published).toMatchObject({ status: "published" });
      expect(published?.first_published_at).toEqual(expect.any(String));
      expect(await ctx.repo().published(slug)).toMatchObject({ slug, title: "Public", data: doc("hello") });

      await ctx.repo().unpublish(page.id, null);
      expect(await ctx.repo().published(slug)).toBeNull();
      expect((await ctx.repo().bySlug(slug))?.published_data).toEqual(doc("hello"));

      await ctx.repo().publish(page.id);
      await ctx.repo().remove(page.id, null);
      expect(await ctx.repo().published(slug)).toBeNull();
    });

    it("keeps a version at each publish and restores one into the draft without publishing it", async () => {
      const slug = ctx.unique("versions");
      const page = await ctx.repo().create({ title: "Versions", slug, data: doc("one"), createdBy: null });
      await ctx.repo().publish(page.id);
      await ctx.repo().saveDraft(page.id, doc("two"), null);
      await ctx.repo().publish(page.id);

      const versions = await ctx.repo().versions(page.id);
      expect(versions).toHaveLength(2);
      expect(await ctx.repo().versions(page.id, 1)).toHaveLength(1);
      const oldest = versions[versions.length - 1];
      expect(await ctx.repo().versionData(oldest.id)).toEqual(normalizeLandingData(doc("one")));

      const restored = await ctx.repo().restoreVersion(oldest.id);

      expect(restored?.draft_data).toEqual(doc("one"));
      expect(restored?.restored_from_version_id).toBe(oldest.id);
      expect((await ctx.repo().published(slug))?.data).toEqual(normalizeLandingData(doc("two")));
      expect(await ctx.repo().versions(page.id)).toHaveLength(2);
      expect(await ctx.repo().restoreVersion(`lpgv_${"A".repeat(12)}`)).toBeNull();
    });

    it("resets the draft to the published copy, and has nothing to reset before the first publish", async () => {
      const slug = ctx.unique("reset");
      const page = await ctx.repo().create({ title: "Reset", slug, data: doc("one"), createdBy: null });
      expect(await ctx.repo().resetDraftToPublished(page.id, null)).toBeNull();

      await ctx.repo().publish(page.id);
      await ctx.repo().saveDraft(page.id, doc("two"), null);
      const reset = await ctx.repo().resetDraftToPublished(page.id, null);

      expect(reset?.draft_data).toEqual(doc("one"));
      expect((await ctx.repo().published(slug))?.data).toEqual(normalizeLandingData(doc("one")));
      expect(await ctx.repo().versions(page.id)).toHaveLength(1);
      expect(await ctx.repo().resetDraftToPublished(`lpg_${"A".repeat(12)}`, null)).toBeNull();
    });

    it("changes the title, address and SEO, and refuses an address in use", async () => {
      const slug = ctx.unique("details");
      const other = ctx.unique("other");
      const page = await ctx.repo().create({ title: "Old", slug, createdBy: null });
      await ctx.repo().create({ title: "Other", slug: other, createdBy: null });
      const moved = ctx.unique("moved");

      const changed = await ctx.repo().updateDetails(page.id, { title: "New", slug: moved, seoTitle: "SEO", seoDescription: "About", socialImageAssetId: null }, null);

      expect(changed).toMatchObject({ title: "New", slug: moved, seo_title: "SEO", seo_description: "About" });
      expect(await ctx.repo().bySlug(slug)).toBeNull();
      await expect(
        ctx.repo().updateDetails(page.id, { title: "New", slug: other, seoTitle: null, seoDescription: null, socialImageAssetId: null }, null),
      ).rejects.toBeInstanceOf(LandingPageSlugTakenError);
    });

    it("lists live pages without their documents, and not deleted ones", async () => {
      const kept = await ctx.repo().create({ title: "Kept", slug: ctx.unique("kept"), createdBy: null });
      const gone = await ctx.repo().create({ title: "Gone", slug: ctx.unique("gone"), createdBy: null });
      await ctx.repo().remove(gone.id, null);

      const listed = await ctx.repo().list();

      expect(listed.find((p) => p.id === kept.id)).toMatchObject({ title: "Kept", status: "draft" });
      expect(listed.find((p) => p.id === gone.id)).toBeUndefined();
      expect(listed[0]).not.toHaveProperty("draft_data");
      expect(await ctx.repo().remove(gone.id, null)).toBe(false);
    });

    it("marks an imported page by its key: one live page per key, found by it, freed on delete", async () => {
      const key = ctx.unique("kajabi:key");
      expect(await ctx.repo().byImportKey(key)).toBeNull();
      const page = await ctx.repo().create({ title: "Imported", slug: ctx.unique("imp"), data: doc("one"), createdBy: null, importKey: key });

      expect(page.import_key).toBe(key);
      expect(page.imported_at).toEqual(expect.any(String));
      expect((await ctx.repo().byImportKey(key))?.id).toBe(page.id);
      expect((await ctx.repo().list()).find((p) => p.id === page.id)?.import_key).toBe(key);
      await expect(ctx.repo().create({ title: "Again", slug: ctx.unique("imp2"), createdBy: null, importKey: key })).rejects.toBeInstanceOf(LandingPageSlugTakenError);

      await ctx.repo().remove(page.id, null);
      expect(await ctx.repo().byImportKey(key)).toBeNull();
      const again = await ctx.repo().create({ title: "Again", slug: ctx.unique("imp3"), createdBy: null, importKey: key });
      expect(again.id).not.toBe(page.id);
    });

    it("replaces only the draft on a repeat import, never the published copy, title, address or versions", async () => {
      const key = ctx.unique("kajabi:replace");
      const slug = ctx.unique("rep");
      const page = await ctx.repo().create({ title: "Title", slug, data: doc("first"), createdBy: null, importKey: key });
      await ctx.repo().publish(page.id);

      const replaced = await ctx.repo().replaceImportedDraft(page.id, doc("second"), null);

      expect(replaced).toMatchObject({ id: page.id, title: "Title", slug, status: "published" });
      expect(replaced?.draft_data).toEqual(doc("second"));
      expect(replaced?.published_data).toEqual(doc("first"));
      expect((await ctx.repo().published(slug))?.data).toEqual(normalizeLandingData(doc("first")));
      expect(await ctx.repo().versions(page.id)).toHaveLength(1);
      expect(await ctx.repo().replaceImportedDraft(`lpg_${"A".repeat(12)}`, doc("x"), null)).toBeNull();
    });

    it("replaces only the draft for a starter, keeping the old draft as a before-starter version, and stamps starter_applied_at", async () => {
      const slug = ctx.unique("st");
      const page = await ctx.repo().create({ title: "Title", slug, data: doc("first"), createdBy: null });
      await ctx.repo().publish(page.id);
      await ctx.repo().saveDraft(page.id, doc("edited"), null);

      const kept = await ctx.repo().keepDraftBeforeStarter(page.id, null);
      const replaced = await ctx.repo().replaceDraftWithStarter(page.id, doc("starter"), null);

      expect(kept).toMatchObject({ page_id: page.id, kind: "before_starter", title: "Title" });
      expect(replaced).toMatchObject({ id: page.id, title: "Title", slug, status: "published" });
      expect(replaced?.starter_applied_at).toEqual(expect.any(String));
      expect(replaced?.draft_data).toEqual(doc("starter"));
      expect(replaced?.published_data).toEqual(doc("first"));
      expect((await ctx.repo().versions(page.id)).map((v) => v.kind).sort()).toEqual(["before_starter", "published"]);
      const missing = `lpg_${"A".repeat(12)}`;
      expect(await ctx.repo().keepDraftBeforeStarter(missing, null)).toBeNull();
      expect(await ctx.repo().replaceDraftWithStarter(missing, doc("x"), null)).toBeNull();
    });

    it("has no import key for a page built in the Hub", async () => {
      const page = await ctx.repo().create({ title: "Hub", slug: ctx.unique("hub"), createdBy: null });
      expect(page.import_key).toBeNull();
      expect(page.imported_at).toBeNull();
    });

    it("keeps templates apart from pages: lists, the public read and what can be used", async () => {
      const pageSlug = ctx.unique("kind-page");
      const kitSlug = ctx.unique("kind-kit");
      const page = await ctx.repo().create({ title: "A page", slug: pageSlug, data: doc("page"), createdBy: null });
      const kit = await ctx.repo().create({ title: "Kit", slug: kitSlug, data: doc("draft one"), createdBy: null, kind: "template" });
      expect(page.kind).toBe("page");
      expect(kit.kind).toBe("template");

      expect((await ctx.repo().list()).map((p) => p.id)).toContain(page.id);
      expect((await ctx.repo().list()).map((p) => p.id)).not.toContain(kit.id);
      expect((await ctx.repo().list("template")).map((p) => p.id)).toContain(kit.id);
      expect((await ctx.repo().list("template")).map((p) => p.id)).not.toContain(page.id);
      expect((await ctx.repo().list("all")).map((p) => p.id)).toEqual(expect.arrayContaining([page.id, kit.id]));
      expect((await ctx.repo().byId(kit.id))?.slug).toBe(kitSlug);
      expect(await ctx.repo().byId(`lpg_${"A".repeat(12)}`)).toBeNull();

      // Never published, or only a draft: not offered, and no published copy to give.
      expect((await ctx.repo().usableTemplates()).map((t) => t.id)).not.toContain(kit.id);
      expect(await ctx.repo().usableTemplateData(kit.id)).toBeNull();

      // Published: offered, with the PUBLISHED document (not the draft being edited), and still never served to a visitor.
      await ctx.repo().publish(kit.id);
      await ctx.repo().saveDraft(kit.id, doc("draft two"), null);
      expect(await ctx.repo().published(kitSlug)).toBeNull();
      expect((await ctx.repo().usableTemplates()).find((t) => t.id === kit.id)).toMatchObject({ title: "Kit", publishedAt: expect.any(String) });
      expect(await ctx.repo().usableTemplateData(kit.id)).toEqual({ title: "Kit", data: normalizeLandingData(doc("draft one")) });
      // A page is not a template.
      await ctx.repo().publish(page.id);
      expect((await ctx.repo().usableTemplates()).map((t) => t.id)).not.toContain(page.id);
      expect(await ctx.repo().usableTemplateData(page.id)).toBeNull();

      // Taken down: no longer offered. Deleted: gone.
      await ctx.repo().unpublish(kit.id, null);
      expect((await ctx.repo().usableTemplates()).map((t) => t.id)).not.toContain(kit.id);
      expect(await ctx.repo().usableTemplateData(kit.id)).toBeNull();
      await ctx.repo().publish(kit.id);
      await ctx.repo().remove(kit.id, null);
      expect(await ctx.repo().usableTemplateData(kit.id)).toBeNull();
      expect(await ctx.repo().byId(kit.id)).toBeNull();
    });

    it("answers null for a page that is gone", async () => {
      const missing = `lpg_${"A".repeat(12)}`;
      expect(await ctx.repo().publish(missing)).toBeNull();
      expect(await ctx.repo().unpublish(missing, null)).toBeNull();
    });
  });
}
