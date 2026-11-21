import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const state: { admin: boolean; repos: Repos; dataset: InMemoryDataset } = { admin: true, repos: undefined as never, dataset: undefined as never };
const revalidated: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => (state.admin ? { ok: true, user: { id: "00000000-0000-4000-a000-0000000000a1", email: "admin@example.test" }, supabase: {} } : { ok: false, error: "Not authorized" }),
}));
const ai = vi.hoisted(() => ({ configured: true, result: undefined as unknown }));
vi.mock("@/lib/landing/ai", () => ({ aiConfigured: () => ai.configured, generateLandingPage: async () => ai.result, reviseLandingPage: async () => ai.result }));
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));

import {
  createLandingPage,
  createLandingPageWithAi,
  generateLandingBlocks,
  importLandingDraftJson,
  reviseLandingBlocks,
  deleteLandingPage,
  duplicateLandingPage,
  publishLandingPage,
  replaceLandingDraftWithStarter,
  resetLandingDraftToPublished,
  restoreLandingPageVersion,
  saveLandingDraft,
  unpublishLandingPage,
  updateLandingPageDetails,
} from "@/app/(admin)/admin/pages/actions";

const title = { type: "Heading", props: { id: "h", text: "Welcome", level: "h1", align: "center" } };
const doc = (...blocks: unknown[]) => ({ content: [title, ...blocks], root: { props: {} } });

async function asset(isPublic = false) {
  return state.repos.media.add({ storage_path: `originals/shared/${crypto.randomUUID()}.png`, mime_type: "image/png", width: 800, height: 600, bytes: 1000, sha256: crypto.randomUUID(), title: "Picture", is_public: isPublic });
}

beforeEach(() => {
  state.admin = true;
  state.dataset = new InMemoryDataset();
  state.repos = createInMemoryRepos(state.dataset);
  revalidated.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("who may use the page builder", () => {
  it("refuses every action to someone who isn't an admin, and writes nothing", async () => {
    state.admin = false;
    const id = "lpg_AAAAAAAAAAA1";
    const results = await Promise.all([
      createLandingPage({ title: "A" }),
      saveLandingDraft(id, doc()),
      updateLandingPageDetails(id, { title: "A", slug: "a", seoTitle: "", seoDescription: "", socialImageAssetId: "" }),
      publishLandingPage(id, doc()),
      unpublishLandingPage(id),
      restoreLandingPageVersion("lpgv_AAAAAAAAAAA1"),
      resetLandingDraftToPublished(id),
      replaceLandingDraftWithStarter(id, "home"),
      importLandingDraftJson(id, "{}"),
      duplicateLandingPage(id),
      deleteLandingPage(id),
    ]);
    for (const result of results) expect(result).toEqual({ error: "Not authorized" });
    expect(state.dataset.landingPages).toEqual([]);
  });
});

describe("createLandingPage", () => {
  it("makes a draft whose address comes from the title", async () => {
    expect(await createLandingPage({ title: "Spring Writing Challenge" })).toEqual({ slug: "spring-writing-challenge" });
    expect(state.dataset.landingPages[0]).toMatchObject({ title: "Spring Writing Challenge", status: "draft" });
  });

  it("refuses a missing title, a bad or reserved address and one already used", async () => {
    expect(await createLandingPage({ title: "  " })).toEqual({ error: "Give the page a title." });
    expect((await createLandingPage({ title: "A", slug: "Not Valid" })).error).toContain("lowercase");
    expect((await createLandingPage({ title: "New", slug: "new" })).error).toContain("lowercase");
    await createLandingPage({ title: "Same", slug: "same" });
    expect(await createLandingPage({ title: "Same again", slug: "same" })).toEqual({ error: "Another page already has that address." });
  });
});

describe("createLandingPage, kind of page", () => {
  it("makes a landing page by default and a website page when asked", async () => {
    await createLandingPage({ title: "Funnel" });
    await createLandingPage({ title: "About", pageType: "website" });
    expect(state.dataset.landingPages.map((p) => [p.slug, p.page_type])).toEqual([["funnel", "landing"], ["about", "website"]]);
  });

  it("refuses an unknown kind, and a starter for the other kind, and writes nothing", async () => {
    expect(await createLandingPage({ title: "X", pageType: "blog" })).toEqual({ error: "Choose a website page or a landing page." });
    expect(await createLandingPage({ title: "Home", starter: "home", pageType: "landing" })).toEqual({ error: "That starting point is for the other kind of page." });
    expect(state.dataset.landingPages).toHaveLength(0);
    expect(await createLandingPage({ title: "Home", slug: "home", starter: "home", pageType: "website" })).toEqual({ slug: "home" });
  });

  it("keeps the kind on a copy, and reserves the tab addresses", async () => {
    await createLandingPage({ title: "About", pageType: "website" });
    const id = state.dataset.landingPages[0].id;
    await duplicateLandingPage(id);
    expect(state.dataset.landingPages.map((p) => p.page_type)).toEqual(["website", "website"]);
    expect((await createLandingPage({ title: "Landing", slug: "landing" })).error).toContain("lowercase");
    expect((await createLandingPage({ title: "Website", slug: "website" })).error).toContain("lowercase");
  });
});

describe("createLandingPage from a starter", () => {
  it("makes an unpublished draft holding the starter's blocks", async () => {
    expect(await createLandingPage({ title: "Quill & Cup", slug: "home", starter: "home", pageType: "website" })).toEqual({ slug: "home" });
    const page = (await state.repos.landingPages.bySlug("home"))!;
    expect(page.status).toBe("draft");
    expect(page.published_data).toBeNull();
    expect((page.draft_data as { content: unknown[] }).content.length).toBeGreaterThan(3);
    expect(await state.repos.landingPages.published("home")).toBeNull();
  });

  it("refuses a starter that doesn't exist and writes nothing", async () => {
    expect(await createLandingPage({ title: "X", starter: "nope" })).toEqual({ error: "That starting point doesn't exist." });
    expect(state.dataset.landingPages).toHaveLength(0);
  });
});

describe("saveLandingDraft (autosave)", () => {
  it("saves a cleaned draft and leaves what is published alone", async () => {
    const { slug } = await createLandingPage({ title: "Page" });
    const page = (await state.repos.landingPages.bySlug(slug!))!;

    const saved = await saveLandingDraft(page.id, doc({ type: "RichText", props: { id: "r", html: "<p>Hi</p><script>x</script>", align: "left" } }));

    expect(saved.savedAt).toEqual(expect.any(String));
    const after = (await state.repos.landingPages.bySlug(slug!))!;
    expect(JSON.stringify(after.draft_data)).toContain("<p>Hi</p>");
    expect(JSON.stringify(after.draft_data)).not.toContain("script");
    expect(after.published_data).toBeNull();
    expect(revalidated).not.toContain(`/p/${slug}`);
  });

  it("refuses an id that isn't a page's, a page that is gone and a document that is too large", async () => {
    expect((await saveLandingDraft("not-an-id", doc())).error).toContain("no longer exists");
    expect((await saveLandingDraft("lpg_AAAAAAAAAAA1", doc())).error).toContain("no longer exists");
    const { slug } = await createLandingPage({ title: "Page" });
    const page = (await state.repos.landingPages.bySlug(slug!))!;
    expect((await saveLandingDraft(page.id, { content: [{ type: "RichText", props: { html: "x".repeat(2_100_000) } }], root: {} })).error).toContain("too large");
  });

  it("reports a failure calmly, without the database's words", async () => {
    const { slug } = await createLandingPage({ title: "Page" });
    const page = (await state.repos.landingPages.bySlug(slug!))!;
    vi.spyOn(state.repos.landingPages, "saveDraft").mockRejectedValueOnce(new Error('relation "landing_pages" does not exist'));
    const result = await saveLandingDraft(page.id, doc());
    expect(result.error).toBe("Couldn't save. Your changes are still here; trying again.");
    expect(result.error).not.toContain("relation");
  });
});

describe("publishLandingPage", () => {
  async function pageWith(_unused: null) {
    const { slug } = await createLandingPage({ title: "Page" });
    return { slug: slug!, id: (await state.repos.landingPages.bySlug(slug!))!.id };
  }

  it("goes live with the draft the editor is showing, keeps a version and makes the pictures public", async () => {
    const picture = await asset();
    const social = await asset();
    const { slug, id } = await pageWith(null);
    await updateLandingPageDetails(id, { title: "Page", slug, seoTitle: "", seoDescription: "", socialImageAssetId: social.id });

    const result = await publishLandingPage(id, doc({ type: "Image", props: { id: "i", imageAssetId: picture.id, alt: "A picture", decorative: false } }));

    expect(result.error).toBeUndefined();
    expect(result.publishedAt).toEqual(expect.any(String));
    const page = (await state.repos.landingPages.bySlug(slug))!;
    expect(page.status).toBe("published");
    expect(JSON.stringify(page.published_data)).toContain(picture.id);
    expect(await state.repos.landingPages.versions(id)).toHaveLength(1);
    expect((await state.repos.media.byId(picture.id))?.is_public).toBe(true);
    expect((await state.repos.media.byId(social.id))?.is_public).toBe(true);
    expect(revalidated).toContain(`/p/${slug}`);
  });

  it("keeps the note typed at publish on the version, trimmed and cut to 200 characters, and never in the Activity Log's rows", async () => {
    const { id } = await pageWith(null);
    await publishLandingPage(id, doc(), { note: "  Fixed the headline  " });
    await publishLandingPage(id, doc(), { note: "x".repeat(300) });
    await publishLandingPage(id, doc(), { note: "   " });
    await publishLandingPage(id, doc());
    const versions = await state.repos.landingPages.versions(id);
    expect(versions.map((v) => v.note)).toEqual([null, null, "x".repeat(200), "Fixed the headline"]);
  });

  it("stops on problems a visitor couldn't work around, and publishes nothing", async () => {
    const { slug, id } = await pageWith(null);
    const result = await publishLandingPage(id, doc({ type: "Image", props: { id: "i", imageAssetId: "media_AAAAAAAAAAA1", alt: "", decorative: false } }));
    expect(result.error).toBe("Fix these before publishing.");
    expect(result.issues?.some((i) => i.severity === "error")).toBe(true);
    expect((await state.repos.landingPages.bySlug(slug))?.status).toBe("draft");
    expect(await state.repos.landingPages.versions(id)).toEqual([]);
  });

  it("lets warnings through and reports them", async () => {
    const { id } = await pageWith(null);
    const result = await publishLandingPage(id, doc({ type: "Button", props: { id: "b", label: "Click here", href: "https://example.com", look: "solid" } }));
    expect(result.error).toBeUndefined();
    expect(result.issues?.map((i) => i.severity)).toEqual(["warning"]);
  });

  it("refuses a page that is gone", async () => {
    expect((await publishLandingPage("lpg_AAAAAAAAAAA1", doc())).error).toContain("no longer exists");
  });
});

describe("unpublish, restore, duplicate and delete", () => {
  async function published() {
    const { slug } = await createLandingPage({ title: "Page", slug: "page" });
    const id = (await state.repos.landingPages.bySlug(slug!))!.id;
    await publishLandingPage(id, doc());
    return id;
  }

  it("takes a page off the public site", async () => {
    const id = await published();
    expect(await unpublishLandingPage(id)).toEqual({ slug: "page" });
    expect(await state.repos.landingPages.published("page")).toBeNull();
    expect(revalidated).toContain("/p/page");
  });

  it("throws the draft's changes away by copying the published page back, leaving the page live", async () => {
    const id = await published();
    await saveLandingDraft(id, doc({ type: "Spacer", props: { id: "s", size: "large" } }));
    expect(JSON.stringify((await state.repos.landingPages.bySlug("page"))!.draft_data)).toContain("Spacer");

    expect(await resetLandingDraftToPublished(id)).toEqual({ slug: "page" });

    const page = (await state.repos.landingPages.bySlug("page"))!;
    expect(JSON.stringify(page.draft_data)).not.toContain("Spacer");
    expect(page.draft_data).toEqual(page.published_data);
    expect(page.status).toBe("published");
    expect(await state.repos.landingPages.versions(id)).toHaveLength(1);
  });

  it("has nothing to go back to for a page that was never published, or one that is gone", async () => {
    const { slug } = await createLandingPage({ title: "Fresh", slug: "fresh" });
    const id = (await state.repos.landingPages.bySlug(slug!))!.id;
    expect(await resetLandingDraftToPublished(id)).toEqual({ error: "There is no published version to go back to." });
    expect(await resetLandingDraftToPublished("not-an-id")).toEqual({ error: "That page no longer exists." });
  });

  it("brings an earlier version back into the draft without publishing it", async () => {
    const id = await published();
    await saveLandingDraft(id, doc({ type: "Spacer", props: { id: "s", size: "large" } }));
    await publishLandingPage(id, doc({ type: "Spacer", props: { id: "s", size: "large" } }));
    const versions = await state.repos.landingPages.versions(id);
    const oldest = versions[versions.length - 1];

    expect(await restoreLandingPageVersion(oldest.id)).toEqual({ slug: "page" });

    const page = (await state.repos.landingPages.bySlug("page"))!;
    expect(JSON.stringify(page.draft_data)).not.toContain("Spacer");
    expect(JSON.stringify(page.published_data)).toContain("Spacer");
    expect((await restoreLandingPageVersion("nope")).error).toContain("no longer exists");
  });

  it("copies a page as a new draft with a free address, again and again", async () => {
    const id = await published();
    const first = await duplicateLandingPage(id);
    const second = await duplicateLandingPage(id);
    expect([first.slug, second.slug]).toEqual(["page-copy", "page-copy-2"]);
    const copy = (await state.repos.landingPages.bySlug("page-copy"))!;
    expect(copy).toMatchObject({ title: "Page (copy)", status: "draft", published_data: null });
  });

  it("deletes a page, which frees its address and removes it from the public site", async () => {
    const id = await published();
    expect(await deleteLandingPage(id)).toEqual({});
    expect(await state.repos.landingPages.published("page")).toBeNull();
    expect(await state.repos.landingPages.bySlug("page")).toBeNull();
    expect((await deleteLandingPage(id)).error).toContain("no longer exists");
    expect(await createLandingPage({ title: "Page", slug: "page" })).toEqual({ slug: "page" });
  });
});

describe("replaceLandingDraftWithStarter", () => {
  async function livePage() {
    await createLandingPage({ title: "My page", slug: "mine" });
    const id = (await state.repos.landingPages.bySlug("mine"))!.id;
    await saveLandingDraft(id, doc());
    await publishLandingPage(id, doc());
    await saveLandingDraft(id, doc({ type: "Spacer", props: { id: "s", size: "large" } }));
    await updateLandingPageDetails(id, { title: "My page", slug: "mine", seoTitle: "Search title", seoDescription: "Words", socialImageAssetId: "" });
    return id;
  }

  it("replaces only the draft, keeps the old draft in History, and touches nothing else", async () => {
    const id = await livePage();
    const before = (await state.repos.landingPages.bySlug("mine"))!;
    const versionsBefore = await state.repos.landingPages.versions(id);

    expect(await replaceLandingDraftWithStarter(id, "home")).toEqual({ slug: "mine" });

    const page = (await state.repos.landingPages.bySlug("mine"))!;
    expect(JSON.stringify(page.draft_data)).toContain("THE END is the best two words");
    expect(JSON.stringify(page.draft_data)).not.toContain("Spacer");
    expect(page.published_data).toEqual(before.published_data);
    expect(page).toMatchObject({ title: "My page", slug: "mine", seo_title: "Search title", seo_description: "Words", status: "published", published_at: before.published_at });
    expect(page.starter_applied_at).toEqual(expect.any(String));
    const versions = await state.repos.landingPages.versions(id);
    expect(versions).toHaveLength(versionsBefore.length + 1);
    expect(versions[0]).toMatchObject({ kind: "before_starter", title: "My page", note: "Replaced by the starter “Homepage”" });
    expect(revalidated).toContain("/admin/pages");
  });

  it("can be undone: the kept draft comes back with Bring back", async () => {
    const id = await livePage();
    await replaceLandingDraftWithStarter(id, "home");
    const kept = (await state.repos.landingPages.versions(id)).find((v) => v.kind === "before_starter")!;

    await restoreLandingPageVersion(kept.id);

    const page = (await state.repos.landingPages.bySlug("mine"))!;
    expect(JSON.stringify(page.draft_data)).toContain("Spacer");
    expect(JSON.stringify(page.draft_data)).not.toContain("THE END is the best two words");
  });

  it("refuses a starter that doesn't exist, a bad id and a page that is gone, and keeps nothing", async () => {
    const id = await livePage();
    const versions = (await state.repos.landingPages.versions(id)).length;
    expect(await replaceLandingDraftWithStarter(id, "nope")).toEqual({ error: "That starting point doesn't exist." });
    expect(await replaceLandingDraftWithStarter("not-an-id", "home")).toEqual({ error: "That page no longer exists." });
    expect(await replaceLandingDraftWithStarter("lpg_AAAAAAAAAAA1", "home")).toEqual({ error: "That page no longer exists." });
    expect((await state.repos.landingPages.versions(id)).length).toBe(versions);
    expect(JSON.stringify((await state.repos.landingPages.bySlug("mine"))!.draft_data)).toContain("Spacer");
  });
});

describe("updateLandingPageDetails", () => {
  it("changes the title, address and search details, and refuses an address in use", async () => {
    await createLandingPage({ title: "One", slug: "one" });
    await createLandingPage({ title: "Two", slug: "two" });
    const id = (await state.repos.landingPages.bySlug("one"))!.id;

    expect(await updateLandingPageDetails(id, { title: "Uno", slug: "uno", seoTitle: " Search ", seoDescription: "", socialImageAssetId: "" })).toEqual({ slug: "uno" });
    expect(await state.repos.landingPages.bySlug("uno")).toMatchObject({ title: "Uno", seo_title: "Search", seo_description: null });
    expect(revalidated).toEqual(expect.arrayContaining(["/p/one", "/p/uno"]));

    expect((await updateLandingPageDetails(id, { title: "Uno", slug: "two", seoTitle: "", seoDescription: "", socialImageAssetId: "" })).error).toContain("already has that address");
    expect((await updateLandingPageDetails(id, { title: "", slug: "uno", seoTitle: "", seoDescription: "", socialImageAssetId: "" })).error).toContain("title");
    expect((await updateLandingPageDetails(id, { title: "x", slug: "Bad Slug", seoTitle: "", seoDescription: "", socialImageAssetId: "" })).error).toContain("lowercase");
  });
});

describe("createLandingPageWithAi", () => {
  const built = { ok: true, data: { content: [{ type: "Heading", props: { id: "h", text: "Hi", level: "h1", align: "center" } }], root: {} }, issues: [] };

  it("saves the generated blocks as an unpublished draft", async () => {
    ai.configured = true;
    ai.result = built;
    expect(await createLandingPageWithAi({ title: "Spring", prompt: "a spring page" })).toEqual({ slug: "spring" });
    const page = state.dataset.landingPages[0];
    expect(page).toMatchObject({ title: "Spring", status: "draft", published_data: null });
    expect((page.draft_data as { content: unknown[] }).content).toHaveLength(1);
  });

  it("creates nothing when the assistant fails, isn't set up, or the title or address is bad", async () => {
    ai.configured = true;
    ai.result = { ok: false, error: "no" };
    expect(await createLandingPageWithAi({ title: "Spring", prompt: "x" })).toEqual({ error: "no" });
    ai.result = built;
    expect((await createLandingPageWithAi({ title: " ", prompt: "x" })).error).toBe("Give the page a title.");
    expect((await createLandingPageWithAi({ title: "A", slug: "Bad Slug", prompt: "x" })).error).toContain("lowercase");
    ai.configured = false;
    expect((await createLandingPageWithAi({ title: "Spring", prompt: "x" })).error).toContain("isn't set up");
    expect(state.dataset.landingPages).toEqual([]);
  });

  it("is for admins only", async () => {
    state.admin = false;
    expect(await createLandingPageWithAi({ title: "Spring", prompt: "x" })).toEqual({ error: "Not authorized" });
  });
});

describe("generateLandingBlocks", () => {
  const blocks = [{ type: "Heading", props: { id: "h", text: "Hi" } }];

  it("returns blocks for the editor and saves nothing", async () => {
    ai.configured = true;
    ai.result = { ok: true, data: { content: blocks, root: {} }, issues: [{ severity: "error", block: "Button", message: "x" }] };
    expect(await generateLandingBlocks("a faq")).toEqual({ blocks, notes: [{ severity: "error", block: "Button", message: "x" }] });
    expect(state.dataset.landingPages).toEqual([]);
  });

  it("passes on the assistant's failure, says when it isn't set up, and refuses non-admins", async () => {
    ai.configured = true;
    ai.result = { ok: false, error: "no" };
    expect(await generateLandingBlocks("x")).toEqual({ error: "no" });
    ai.configured = false;
    expect((await generateLandingBlocks("x")).error).toContain("isn't set up");
    state.admin = false;
    expect(await generateLandingBlocks("x")).toEqual({ error: "Not authorized" });
  });
});

describe("reviseLandingBlocks", () => {
  const blocks = [{ type: "Heading", props: { id: "h", text: "Shorter" } }];

  it("returns the revised blocks and saves nothing", async () => {
    ai.configured = true;
    ai.result = { ok: true, data: { content: blocks, root: {} }, issues: [] };
    expect(await reviseLandingBlocks("shorter", [{ type: "Heading", props: { id: "h" } }])).toEqual({ blocks, notes: [] });
    expect(state.dataset.landingPages).toEqual([]);
  });

  it("passes on a failure, says when it isn't set up, refuses a huge page and non-admins", async () => {
    ai.configured = true;
    ai.result = { ok: false, error: "unchanged" };
    expect(await reviseLandingBlocks("x", [{}])).toEqual({ error: "unchanged" });
    expect((await reviseLandingBlocks("x", [{ big: "x".repeat(2_000_001) }])).error).toContain("too large");
    ai.configured = false;
    expect((await reviseLandingBlocks("x", [{}])).error).toContain("isn't set up");
    state.admin = false;
    expect(await reviseLandingBlocks("x", [{}])).toEqual({ error: "Not authorized" });
  });
});
