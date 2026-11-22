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
vi.mock("@/lib/landing/ai", () => ({ aiConfigured: () => false, generateLandingPage: async () => undefined, reviseLandingPage: async () => undefined }));
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));

import { createLandingPage, publishLandingPage, unpublishLandingPage, duplicateLandingPage, deleteLandingPage } from "@/app/(admin)/admin/pages/actions";
import { replaceLandingDraftWithTemplate, saveLandingTemplate } from "@/app/(admin)/admin/pages/template-actions";

const heading = (text: string) => ({ type: "Heading", props: { id: "h", text, level: "h1", align: "center" } });
const doc = (text = "Welcome", ...more: unknown[]) => ({ content: [heading(text), ...more], root: { props: {} } });
const words = (value: { draft_data?: unknown; published_data?: unknown } | null, which: "draft_data" | "published_data" = "draft_data") =>
  (JSON.stringify(value?.[which]).match(/"text":"([^"]*)"/) ?? [])[1];
const linklessButton = { type: "Button", props: { id: "b", label: "Join", href: "", look: "solid", color: "plum", shape: "pill", align: "left" } };

async function page(slug: string, text: string) {
  await createLandingPage({ title: `Page ${slug}`, slug });
  const made = (await state.repos.landingPages.bySlug(slug))!;
  await state.repos.landingPages.saveDraft(made.id, doc(text) as never, null);
  return (await state.repos.landingPages.bySlug(slug))!;
}
const templateBySlug = async (slug: string) => (await state.repos.landingPages.bySlug(slug))!;
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

describe("who may use templates", () => {
  it("refuses saving and using to someone who isn't an admin, and writes nothing", async () => {
    state.admin = false;
    expect(await saveLandingTemplate(doc(), { name: "A" })).toEqual({ error: "Not authorized" });
    expect(await replaceLandingDraftWithTemplate("lpg_AAAAAAAAAAA1", "lpg_AAAAAAAAAAA2")).toEqual({ error: "Not authorized" });
    expect(await createLandingPage({ title: "A", template: "lpg_AAAAAAAAAAA2" })).toEqual({ error: "Not authorized" });
    expect(state.dataset.landingPages).toEqual([]);
  });
});

describe("saveLandingTemplate: a new template", () => {
  it("makes a template whose DRAFT is the page, cleaned like a save; it is not published and not in the pages list; the page is untouched", async () => {
    const source = await page("spring", "Spring words");
    const before = JSON.stringify(source);

    const result = await saveLandingTemplate(doc("Hello", { type: "RichText", props: { id: "r", html: "<p>Hi</p><script>x</script>", align: "left" } }), { name: "  Launch kit " });

    expect(result).toMatchObject({ name: "Launch kit", slug: "launch-kit", published: false });
    const template = await templateBySlug("launch-kit");
    expect(template).toMatchObject({ kind: "template", title: "Launch kit", status: "draft", published_data: null });
    expect(JSON.stringify(template.draft_data)).toContain("<p>Hi</p>");
    expect(JSON.stringify(template.draft_data)).not.toContain("script");
    expect((await state.repos.landingPages.list()).map((p) => p.slug)).toEqual(["spring"]);
    expect((await state.repos.landingPages.list("template")).map((p) => p.slug)).toEqual(["launch-kit"]);
    expect(JSON.stringify(await state.repos.landingPages.bySlug("spring"))).toBe(before);
    expect(await state.repos.landingPages.published("launch-kit")).toBeNull();
    expect(await state.repos.landingPages.usableTemplates()).toEqual([]);
  });

  it("takes the kind of the page it was saved from, so it is offered for that kind of page only", async () => {
    await createLandingPage({ title: "About", slug: "about", pageType: "website" });
    const about = (await state.repos.landingPages.bySlug("about"))!;
    await state.repos.landingPages.saveDraft(about.id, doc("Site words") as never, null);
    await saveLandingTemplate(doc("Site words"), { name: "Site kit", fromPageId: about.id, publish: true });
    expect((await templateBySlug("site-kit")).page_type).toBe("website");
    expect((await state.repos.landingPages.usableTemplates("website")).map((t) => t.title)).toEqual(["Site kit"]);
    expect(await state.repos.landingPages.usableTemplates("landing")).toEqual([]);
  });

  it("can publish it in the same step: one version, a published copy, no picture made public", async () => {
    const picture = await asset();
    const source = await page("spring", "Spring words");
    const result = await saveLandingTemplate(doc("Hello", { type: "Image", props: { id: "i", imageAssetId: picture.id, alt: "A picture", decorative: false, align: "center" } }), { name: "Kit", publish: true, fromPageId: source.id });

    expect(result.published).toBe(true);
    const template = await templateBySlug("kit");
    expect(template.status).toBe("published");
    expect(words(template, "published_data")).toBe("Hello");
    const made = await state.repos.landingPages.versions(template.id);
    expect(made).toHaveLength(1);
    // The automatic note names the page by its title only, never what is on it.
    expect(made[0].note).toBe("Saved from the page “Page spring”");
    expect((await state.repos.media.byId(picture.id))?.is_public).toBe(false);
    expect((await state.repos.landingPages.usableTemplates()).map((t) => t.id)).toEqual([template.id]);
    expect(await state.repos.landingPages.published("kit")).toBeNull();
  });

  it("gives each template a free address, refuses a name that is taken, a missing name, an empty page and a page over the size cap", async () => {
    expect((await saveLandingTemplate(doc(), { name: "New" })).slug).toBe("new-template");
    expect((await saveLandingTemplate(doc(), { name: "Kit" })).slug).toBe("kit");
    await createLandingPage({ title: "Kit page", slug: "kit-2" });
    expect((await saveLandingTemplate(doc(), { name: "Kit!" })).slug).toBe("kit-3");
    expect((await saveLandingTemplate(doc(), { name: " kit " })).error).toContain("already exists");
    expect(await saveLandingTemplate(doc(), { name: "  " })).toEqual({ error: "Give the template a name." });
    expect((await saveLandingTemplate(doc(), { name: "x".repeat(81) })).error).toContain("name");
    expect((await saveLandingTemplate({ content: [], root: {} }, { name: "Blank" })).error).toContain("empty");
    const big = doc("Big", { type: "RichText", props: { id: "r", html: `<p>${"x".repeat(2_100_000)}</p>`, align: "left" } });
    expect((await saveLandingTemplate(big, { name: "Big" })).error).toContain("too large");
    expect((await state.repos.landingPages.list("template")).map((t) => t.title).sort()).toEqual(["Kit", "Kit!", "New"]);
  });

  it("reports a failure calmly, without the database's words", async () => {
    vi.spyOn(state.repos.landingPages, "create").mockRejectedValueOnce(new Error('relation "landing_pages" does not exist'));
    expect(await saveLandingTemplate(doc(), { name: "Kit" })).toEqual({ error: "Couldn't save the template." });
  });
});

describe("saveLandingTemplate: replace a template's draft with a page", () => {
  async function publishedTemplate() {
    await saveLandingTemplate(doc("Version one"), { name: "Kit", publish: true });
    return templateBySlug("kit");
  }

  it("without publishing: keeps the published copy and its versions as they were, keeps the old draft in History, and leaves the page alone", async () => {
    const template = await publishedTemplate();
    await state.repos.landingPages.saveDraft(template.id, doc("Unpublished edits") as never, null);
    const source = await page("spring", "New words");
    const sourceBefore = JSON.stringify(source);
    const versionsBefore = JSON.stringify(await state.repos.landingPages.versions(template.id));

    const result = await saveLandingTemplate(doc("New words"), { replaceId: template.id, fromPageId: source.id });

    expect(result).toMatchObject({ templateId: template.id, name: "Kit", published: false });
    const after = await templateBySlug("kit");
    expect(words(after)).toBe("New words");
    expect(words(after, "published_data")).toBe("Version one");
    expect(after.status).toBe("published");
    const versions = await state.repos.landingPages.versions(template.id);
    expect(versions.map((v) => v.kind)).toEqual(["before_replace", "published"]);
    expect(versions[0].note).toBe("Replaced by the page “Page spring”");
    expect(JSON.stringify(versions.filter((v) => v.kind === "published"))).toBe(JSON.stringify(JSON.parse(versionsBefore)));
    expect(words({ draft_data: await state.repos.landingPages.versionData(versions[0].id) })).toBe("Unpublished edits");
    expect(JSON.stringify(await state.repos.landingPages.bySlug("spring"))).toBe(sourceBefore);
    // Still offered, and still with the published copy.
    expect((await state.repos.landingPages.usableTemplateData(template.id))?.data).toMatchObject({ content: [{ props: { text: "Version one" } }] });
  });

  it("with publishing: adds exactly one new version and the published copy becomes the page, and the page is untouched", async () => {
    const template = await publishedTemplate();
    const source = await page("spring", "New words");
    const sourceBefore = JSON.stringify(source);

    const result = await saveLandingTemplate(doc("New words"), { replaceId: template.id, publish: true, fromPageId: source.id });

    expect(result.published).toBe(true);
    const after = await templateBySlug("kit");
    expect(words(after, "published_data")).toBe("New words");
    const versions = await state.repos.landingPages.versions(template.id);
    // The draft kept before the replacement, the first publish and the new publish: one more published version than before.
    expect(versions.filter((v) => v.kind === "published")).toHaveLength(2);
    expect(versions).toHaveLength(3);
    expect(versions[0].note).toBe("Saved from the page “Page spring”");
    expect(JSON.stringify(await state.repos.landingPages.bySlug("spring"))).toBe(sourceBefore);
    expect(await state.repos.landingPages.published("kit")).toBeNull();
  });

  it("refuses a template that is gone, an id that isn't one, and a page that isn't a template", async () => {
    const normal = await page("spring", "Words");
    expect(await saveLandingTemplate(doc(), { replaceId: "lpg_AAAAAAAAAAA1" })).toEqual({ error: "That template is no longer available." });
    expect(await saveLandingTemplate(doc(), { replaceId: "nope" })).toEqual({ error: "That template is no longer available." });
    expect(await saveLandingTemplate(doc("Other"), { replaceId: normal.id })).toEqual({ error: "That template is no longer available." });
    expect(words(await state.repos.landingPages.bySlug("spring"))).toBe("Words");
    expect(await state.repos.landingPages.versions(normal.id)).toEqual([]);
  });
});

describe("a template publishes like a page, with its own rules", () => {
  it("publishes with a button that has no link (a warning for a template, an error for a page) and makes no picture public", async () => {
    await saveLandingTemplate(doc("Kit", linklessButton), { name: "Kit" });
    const template = await templateBySlug("kit");
    const picture = await asset();
    const content = doc("Kit", linklessButton, { type: "Image", props: { id: "i", imageAssetId: picture.id, alt: "A picture", decorative: false, align: "center" } });

    const result = await publishLandingPage(template.id, content);

    expect(result.error).toBeUndefined();
    expect(result.issues?.every((i) => i.severity === "warning")).toBe(true);
    expect(result.issues?.length).toBeGreaterThan(0);
    expect((await state.repos.media.byId(picture.id))?.is_public).toBe(false);
    expect(revalidated).not.toContain("/p/kit");

    const normal = await page("spring", "Words");
    const refused = await publishLandingPage(normal.id, content);
    expect(refused.error).toBe("Fix these before publishing.");
    expect(await state.repos.landingPages.versions(normal.id)).toEqual([]);

    // A page made from the template marks its pictures public when IT is published.
    await createLandingPage({ title: "From kit", slug: "from-kit", template: template.id });
  });

  it("is offered only while published: taking it down, deleting it or never publishing it keeps it out", async () => {
    await saveLandingTemplate(doc("Kit"), { name: "Kit" });
    const template = await templateBySlug("kit");
    expect(await createLandingPage({ title: "X", slug: "x", template: template.id })).toEqual({ error: "That template is no longer available." });

    await publishLandingPage(template.id, doc("Kit"));
    expect((await state.repos.landingPages.usableTemplates()).map((t) => t.id)).toEqual([template.id]);

    await unpublishLandingPage(template.id);
    expect(await state.repos.landingPages.usableTemplates()).toEqual([]);
    expect(await createLandingPage({ title: "X", slug: "x", template: template.id })).toEqual({ error: "That template is no longer available." });

    await publishLandingPage(template.id, doc("Kit"));
    expect(await deleteLandingPage(template.id)).toEqual({});
    expect(await state.repos.landingPages.usableTemplates()).toEqual([]);
  });

  it("duplicates as a template, with the draft, and is not public either", async () => {
    await saveLandingTemplate(doc("Kit"), { name: "Kit", publish: true });
    const template = await templateBySlug("kit");

    const copy = await duplicateLandingPage(template.id);

    expect(copy).toEqual({ slug: "kit-copy" });
    expect(await templateBySlug("kit-copy")).toMatchObject({ kind: "template", status: "draft", title: "Kit (copy)" });
    expect(await state.repos.landingPages.published("kit-copy")).toBeNull();
  });
});

describe("using a template", () => {
  async function published(text: string) {
    await saveLandingTemplate(doc(text), { name: "Kit", publish: true });
    return templateBySlug("kit");
  }

  it("makes a draft page from its PUBLISHED copy, never its draft, never published, cleaned again", async () => {
    const template = await published("Published words");
    await state.repos.landingPages.saveDraft(template.id, doc("Draft words") as never, null);
    // Whatever the database holds, what is used is cleaned again.
    const row = state.dataset.landingPages.find((p) => p.id === template.id)!;
    row.published_data = { content: [{ type: "RichText", props: { id: "r", html: "<p>Hi</p><script>x</script>", align: "left" } }], root: {} };

    expect(await createLandingPage({ title: "From kit", slug: "from-kit", template: template.id })).toEqual({ slug: "from-kit" });

    const made = (await state.repos.landingPages.bySlug("from-kit"))!;
    expect(made).toMatchObject({ kind: "page", status: "draft", published_data: null, title: "From kit" });
    expect(JSON.stringify(made.draft_data)).toContain("<p>Hi</p>");
    expect(JSON.stringify(made.draft_data)).not.toContain("script");
    expect(JSON.stringify(made.draft_data)).not.toContain("Draft words");
    expect(await createLandingPage({ title: "X", template: "nope" })).toEqual({ error: "That template is no longer available." });
    expect(await createLandingPage({ title: "X", template: "lpg_AAAAAAAAAAA1" })).toEqual({ error: "That template is no longer available." });
    // A plain page is not a template.
    const normal = await page("spring", "Words");
    await publishLandingPage(normal.id, doc("Words"));
    expect(await createLandingPage({ title: "Y", template: normal.id })).toEqual({ error: "That template is no longer available." });
  });

  it("replaces a page's draft, keeping the previous draft in History and leaving the published copy, title and address alone", async () => {
    const template = await published("From the template");
    await createLandingPage({ title: "Live page", slug: "live" });
    const live = (await state.repos.landingPages.bySlug("live"))!;
    await state.repos.landingPages.saveDraft(live.id, doc("My own words") as never, null);
    await state.repos.landingPages.publish(live.id);
    await state.repos.landingPages.saveDraft(live.id, doc("Unpublished edits") as never, null);

    expect(await replaceLandingDraftWithTemplate(live.id, template.id)).toEqual({ slug: "live" });

    const after = (await state.repos.landingPages.bySlug("live"))!;
    expect(words(after)).toBe("From the template");
    expect(words(after, "published_data")).toBe("My own words");
    expect(after).toMatchObject({ title: "Live page", slug: "live", status: "published" });
    const versions = await state.repos.landingPages.versions(live.id);
    expect(versions[0].kind).toBe("before_replace");
    expect(versions[0].note).toBe("Replaced by the template “Kit”");
    expect(JSON.stringify(await state.repos.landingPages.versionData(versions[0].id))).toContain("Unpublished edits");
  });

  it("refuses a template or page that is gone and changes nothing", async () => {
    await page("live", "Words");
    const live = (await state.repos.landingPages.bySlug("live"))!;
    expect(await replaceLandingDraftWithTemplate(live.id, "lpg_AAAAAAAAAAA1")).toEqual({ error: "That template is no longer available." });
    const template = await published("Kit words");
    expect(await replaceLandingDraftWithTemplate("lpg_AAAAAAAAAAA1", template.id)).toEqual({ error: "That page no longer exists." });
    expect(await replaceLandingDraftWithTemplate("nope", template.id)).toEqual({ error: "That page no longer exists." });
    expect(await state.repos.landingPages.versions(live.id)).toEqual([]);
    expect(words(await state.repos.landingPages.bySlug("live"))).toBe("Words");
  });

  it("reports a failure calmly", async () => {
    const template = await published("Kit words");
    await page("live", "Words");
    const live = (await state.repos.landingPages.bySlug("live"))!;
    vi.spyOn(state.repos.landingPages, "keepDraftBeforeReplace").mockRejectedValueOnce(new Error("boom"));
    expect(await replaceLandingDraftWithTemplate(live.id, template.id)).toEqual({ error: "Couldn't replace the draft." });
    vi.spyOn(state.repos.landingPages, "usableTemplateData").mockRejectedValueOnce(new Error("boom"));
    expect(await createLandingPage({ title: "X", template: template.id })).toEqual({ error: "Couldn't create the page." });
  });
});
