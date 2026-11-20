import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { buildLandingExport } from "@/lib/landing/json-transfer";

const state: { admin: boolean; repos: Repos; dataset: InMemoryDataset } = { admin: true, repos: undefined as never, dataset: undefined as never };
const revalidated: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => (state.admin ? { ok: true, user: { id: "00000000-0000-4000-a000-0000000000a1", email: "admin@example.test" }, supabase: {} } : { ok: false, error: "Not authorized" }),
}));
vi.mock("@/lib/landing/ai", () => ({ aiConfigured: () => false, generateLandingPage: async () => undefined, reviseLandingPage: async () => undefined }));
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));

import {
  createLandingPage,
  importLandingDraftJson,
  publishLandingPage,
  restoreLandingPageVersion,
  saveLandingDraft,
  updateLandingPageDetails,
} from "@/app/(admin)/admin/pages/actions";

const title = { type: "Heading", props: { id: "h", text: "Welcome", level: "h1", align: "center" } };
const doc = (...blocks: unknown[]) => ({ content: [title, ...blocks], root: { props: {} } });
const NOW = new Date("2026-11-21T15:00:00Z");
const spacer = { type: "Spacer", props: { id: "s", size: "large" } };

async function asset() {
  return state.repos.media.add({ storage_path: `originals/shared/${crypto.randomUUID()}.png`, mime_type: "image/png", width: 800, height: 600, bytes: 1000, sha256: crypto.randomUUID(), title: "Picture", is_public: false });
}

beforeEach(() => {
  state.admin = true;
  state.dataset = new InMemoryDataset();
  state.repos = createInMemoryRepos(state.dataset);
  revalidated.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function livePage() {
  await createLandingPage({ title: "My page", slug: "mine" });
  const id = (await state.repos.landingPages.bySlug("mine"))!.id;
  await saveLandingDraft(id, doc());
  await publishLandingPage(id, doc());
  await saveLandingDraft(id, doc(spacer));
  await updateLandingPageDetails(id, { title: "My page", slug: "mine", seoTitle: "Search title", seoDescription: "Words", socialImageAssetId: "" });
  return id;
}
const file = (data: unknown, over: Record<string, unknown> = {}) => JSON.stringify({ format: "hedgie-landing-page", version: 1, slug: "elsewhere", title: "Elsewhere", kind: "draft", exportedAt: NOW.toISOString(), data, ...over });
const draftOf = async () => (await state.repos.landingPages.bySlug("mine"))!.draft_data;

describe("importLandingDraftJson", () => {
  it("refuses someone who isn't an admin, and writes nothing", async () => {
    const id = await livePage();
    state.admin = false;
    expect(await importLandingDraftJson(id, file(doc()))).toEqual({ error: "Not authorized" });
    expect(await importLandingDraftJson(id, file(doc()), { dryRun: true })).toEqual({ error: "Not authorized" });
    state.admin = true;
    expect(JSON.stringify(await draftOf())).toContain("Spacer");
  });

  it("refuses text that isn't a page, with a plain message, and writes nothing", async () => {
    const id = await livePage();
    const versions = (await state.repos.landingPages.versions(id)).length;
    expect((await importLandingDraftJson(id, "{ nope")).error).toMatch(/isn't JSON/);
    expect((await importLandingDraftJson(id, JSON.stringify({ format: "other", data: doc() }))).error).toMatch(/isn't a page exported/);
    expect((await importLandingDraftJson(id, JSON.stringify({ root: {} }))).error).toMatch(/no list of blocks/);
    expect((await importLandingDraftJson(id, " ".repeat(2_000_001))).error).toMatch(/2 MB/);
    expect((await importLandingDraftJson(id, undefined as never)).error).toMatch(/Choose a file/);
    expect(await importLandingDraftJson("not-an-id", file(doc()))).toEqual({ error: "That page no longer exists." });
    expect(await importLandingDraftJson("lpg_AAAAAAAAAAA1", file(doc()))).toEqual({ error: "That page no longer exists." });
    expect((await state.repos.landingPages.versions(id)).length).toBe(versions);
    expect(JSON.stringify(await draftOf())).toContain("Spacer");
  });

  it("replaces only the draft, keeps the old draft in History, and touches nothing else", async () => {
    const id = await livePage();
    const before = (await state.repos.landingPages.bySlug("mine"))!;
    const versionsBefore = await state.repos.landingPages.versions(id);
    const text = file({ content: [{ type: "Heading", props: { id: "n", text: "Brand new", level: "h1", align: "left" } }], root: {} });

    const result = await importLandingDraftJson(id, text);

    expect(result).toMatchObject({ applied: true, summary: { blocksBefore: 2, blocksAfter: 1, identical: false } });
    const page = (await state.repos.landingPages.bySlug("mine"))!;
    expect(JSON.stringify(page.draft_data)).toContain("Brand new");
    expect(JSON.stringify(page.draft_data)).not.toContain("Spacer");
    expect(page.draft_data).toMatchObject({ schemaVersion: expect.any(Number) });
    // Not the title, address or search settings the file names, and not the live copy.
    expect(page.published_data).toEqual(before.published_data);
    expect(page).toMatchObject({ title: "My page", slug: "mine", seo_title: "Search title", seo_description: "Words", status: "published", published_at: before.published_at });
    const versions = await state.repos.landingPages.versions(id);
    expect(versions).toHaveLength(versionsBefore.length + 1);
    expect(versions[0]).toMatchObject({ kind: "before_starter", title: "My page", note: "Replaced by a JSON import" });
    expect(versions.slice(1).map((v) => v.id)).toEqual(versionsBefore.map((v) => v.id));
    expect(await state.repos.landingPages.published("mine")).toMatchObject({ title: "My page" });
    expect(revalidated).toContain("/admin/pages");
    // A file never makes a page.
    expect(state.dataset.landingPages).toHaveLength(1);
  });

  it("can be undone: the kept draft comes back with Bring back", async () => {
    const id = await livePage();
    await importLandingDraftJson(id, file(doc({ type: "Heading", props: { id: "n", text: "Brand new", level: "h2", align: "left" } })));
    const kept = (await state.repos.landingPages.versions(id)).find((v) => v.kind === "before_starter")!;

    await restoreLandingPageVersion(kept.id);

    expect(JSON.stringify(await draftOf())).toContain("Spacer");
    expect(JSON.stringify(await draftOf())).not.toContain("Brand new");
  });

  it("reads a bare document as well as the wrapper", async () => {
    const id = await livePage();
    const result = await importLandingDraftJson(id, JSON.stringify({ content: [{ type: "Divider", props: { id: "d", look: "line" } }], root: {} }));
    expect(result).toMatchObject({ applied: true, summary: { blocksAfter: 1, source: undefined } });
  });

  it("reports where the file says it came from, without using it", async () => {
    const id = await livePage();
    const result = await importLandingDraftJson(id, file(doc(), { slug: "other-page", title: "Other", kind: "published" }), { dryRun: true });
    expect(result.summary?.source).toEqual({ slug: "other-page", title: "Other", kind: "published" });
  });

  it("leaves out blocks the builder doesn't have, at any depth, and says which", async () => {
    const id = await livePage();
    const data = {
      content: [
        title,
        { type: "Gizmo", props: { id: "g1" } },
        { type: "Section", props: { id: "sec", content: [{ type: "Gizmo", props: { id: "g2" } }, spacer] } },
        { type: "Columns", props: { id: "cols", count: "2", col1: [{ type: "Widget", props: { id: "w" } }], col2: [{ type: "Heading", props: { id: "h2", text: "Inside", level: "h2", align: "left" } }] } },
      ],
      root: {},
    };
    const result = await importLandingDraftJson(id, file(data));
    expect(result.summary).toMatchObject({ leftOut: [{ type: "Gizmo", count: 2 }, { type: "Widget", count: 1 }], blocksAfter: 5 });
    const text = JSON.stringify(await draftOf());
    expect(text).not.toContain("Gizmo");
    expect(text).not.toContain("Widget");
    expect(text).toContain("Inside");
  });

  it("drops props a block doesn't have", async () => {
    const id = await livePage();
    const result = await importLandingDraftJson(id, file({ content: [{ type: "Heading", props: { id: "h", text: "Hi", level: "h2", align: "left", onClick: "alert(1)" } }], root: { props: { showHeader: false, sneaky: 1 } } }));
    expect(result.summary?.droppedProps).toBe(2);
    expect(JSON.stringify(await draftOf())).not.toContain("onClick");
    expect(JSON.stringify(await draftOf())).not.toContain("sneaky");
  });

  it("cleans rich text and links as a save does", async () => {
    const id = await livePage();
    const data = {
      content: [
        { type: "RichText", props: { id: "r", html: '<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://example.com/ok">ok</a></p><img src="x">', align: "left" } },
        { type: "Button", props: { id: "b", label: "Go", href: "javascript:alert(1)", look: "solid", color: "plum", shape: "pill", align: "center", full: false } },
      ],
      root: {},
    };
    await importLandingDraftJson(id, file(data));
    const text = JSON.stringify(await draftOf());
    expect(text).not.toMatch(/onclick|<script|javascript:|<img/i);
    expect(text).toContain("https://example.com/ok");
    const button = ((await draftOf()) as { content: { props: Record<string, unknown> }[] }).content[1];
    expect(button.props.href).toBe("");
  });

  it("clears pictures that aren't in this library, keeps the ones that are, and says how many", async () => {
    const id = await livePage();
    const here = await asset();
    const gone = await asset();
    await state.repos.media.remove(gone.id);
    const image = (imageId: string, imageAssetId: string) => ({ type: "Image", props: { id: imageId, imageAssetId, alt: "A pen", decorative: false, size: "medium", rounded: true, align: "center" } });
    const data = { content: [title, image("i1", here.id), image("i2", "mda_ZZZZZZZZZZZZ"), image("i3", gone.id), image("i4", "mda_ZZZZZZZZZZZZ")], root: { props: { logoAssetId: "mda_YYYYYYYYYYYY" } } };

    const result = await importLandingDraftJson(id, file(data));

    expect(result.summary?.removedPictures).toBe(4);
    const saved = (await draftOf()) as { content: { props: Record<string, unknown> }[]; root: { props: Record<string, unknown> } };
    expect(saved.content.slice(1).map((b) => b.props.imageAssetId)).toEqual([here.id, "", "", ""]);
    expect(saved.root.props.logoAssetId).toBe("");
  });

  it("reports what the publish check would raise", async () => {
    const id = await livePage();
    const result = await importLandingDraftJson(id, file({ content: [{ type: "Button", props: { id: "b", label: "Join us", href: "", look: "solid", color: "plum", shape: "pill", align: "center", full: false } }], root: {} }), { dryRun: true });
    expect(result.summary?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", message: expect.stringContaining("Join us") })]));
  });

  it("migrates old props, like any stored page", async () => {
    const id = await livePage();
    const old = { content: [{ type: "JourneyMap", props: { id: "j", offer: { title: "Offer", text: "Text" }, stages: [{ name: "Start", current: true }] } }], root: {} };
    await importLandingDraftJson(id, JSON.stringify(old));
    const text = JSON.stringify(await draftOf());
    expect(text).toContain('"offers"');
    expect(text).not.toContain('"offer":');
  });

  describe("dry run", () => {
    it("writes nothing and gives the summary the real import gives", async () => {
      const id = await livePage();
      const before = await state.repos.landingPages.bySlug("mine");
      const versions = (await state.repos.landingPages.versions(id)).length;
      const text = file({ content: [title, { type: "Gizmo", props: { id: "g" } }, { type: "Image", props: { id: "i", imageAssetId: "mda_ZZZZZZZZZZZZ", alt: "x", decorative: false } }], root: {} });

      const dry = await importLandingDraftJson(id, text, { dryRun: true });

      expect(dry.applied).toBe(false);
      expect(await state.repos.landingPages.bySlug("mine")).toEqual(before);
      expect((await state.repos.landingPages.versions(id)).length).toBe(versions);
      const real = await importLandingDraftJson(id, text);
      expect(real.applied).toBe(true);
      expect(real.summary).toEqual(dry.summary);
    });

    it("also refuses what the real import refuses", async () => {
      const id = await livePage();
      expect((await importLandingDraftJson(id, "{ nope", { dryRun: true })).error).toMatch(/isn't JSON/);
    });
  });

  describe("importing a page's own export", () => {
    it("leaves it identical: no new version, no write", async () => {
      const id = await livePage();
      const page = (await state.repos.landingPages.bySlug("mine"))!;
      const exported = buildLandingExport({ slug: page.slug, title: page.title, kind: "draft", data: page.draft_data, now: NOW });
      if (!exported.ok) throw new Error(exported.error);
      const versions = (await state.repos.landingPages.versions(id)).length;

      const result = await importLandingDraftJson(id, exported.json);

      expect(result).toMatchObject({ applied: false, summary: { identical: true, leftOut: [], droppedProps: 0, removedPictures: 0 } });
      expect(await state.repos.landingPages.bySlug("mine")).toEqual(page);
      expect((await state.repos.landingPages.versions(id)).length).toBe(versions);
    });

    it("is identical for a starter's page, with its nested blocks", async () => {
      await createLandingPage({ title: "From starter", slug: "starter", starter: "home" });
      const page = (await state.repos.landingPages.bySlug("starter"))!;
      const exported = buildLandingExport({ slug: page.slug, title: page.title, kind: "draft", data: page.draft_data, now: NOW });
      if (!exported.ok) throw new Error(exported.error);
      const result = await importLandingDraftJson(page.id, exported.json, { dryRun: true });
      expect(result.summary).toMatchObject({ identical: true, leftOut: [], droppedProps: 0 });
      expect(result.summary!.blocksAfter).toBeGreaterThan(5);
    });

    it("carries a draft from one page into another without touching either page's own details", async () => {
      await livePage();
      await createLandingPage({ title: "Second", slug: "second" });
      const second = (await state.repos.landingPages.bySlug("second"))!;
      const source = (await state.repos.landingPages.bySlug("mine"))!;
      const exported = buildLandingExport({ slug: source.slug, title: source.title, kind: "draft", data: source.draft_data, now: NOW });
      if (!exported.ok) throw new Error(exported.error);

      await importLandingDraftJson(second.id, exported.json);

      const after = (await state.repos.landingPages.bySlug("second"))!;
      expect(after).toMatchObject({ title: "Second", slug: "second", status: "draft" });
      expect(JSON.stringify(after.draft_data)).toContain("Spacer");
      expect((await state.repos.landingPages.bySlug("mine"))!.draft_data).toEqual(source.draft_data);
    });
  });

  it("reports a failure as a plain message", async () => {
    const id = await livePage();
    vi.spyOn(state.repos.landingPages, "replaceDraftWithStarter").mockRejectedValueOnce(new Error("db down"));
    expect(await importLandingDraftJson(id, file(doc()))).toEqual({ error: "Couldn't import the page." });
  });
});
