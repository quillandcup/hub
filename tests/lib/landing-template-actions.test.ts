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

import { createLandingPage } from "@/app/(admin)/admin/pages/actions";
import {
  deleteLandingTemplate,
  loadLandingTemplateOutline,
  loadLandingTemplateVersions,
  replaceLandingDraftWithTemplate,
  restoreLandingTemplateVersion,
  saveLandingTemplate,
  updateLandingTemplateDetails,
} from "@/app/(admin)/admin/pages/template-actions";

const heading = (text: string) => ({ type: "Heading", props: { id: "h", text, level: "h1", align: "center" } });
const doc = (text = "Welcome", ...more: unknown[]) => ({ content: [heading(text), ...more], root: { props: {} } });
const text = (page: { draft_data: unknown } | null) => (JSON.stringify(page?.draft_data).match(/"text":"([^"]*)"/) ?? [])[1];

beforeEach(() => {
  state.admin = true;
  state.dataset = new InMemoryDataset();
  state.repos = createInMemoryRepos(state.dataset);
  revalidated.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("who may use templates", () => {
  it("refuses every action to someone who isn't an admin, and writes nothing", async () => {
    state.admin = false;
    const results = await Promise.all([
      saveLandingTemplate(doc(), { name: "A" }),
      restoreLandingTemplateVersion("lpgtv_AAAAAAAAAAA1"),
      updateLandingTemplateDetails("lpgt_AAAAAAAAAAA1", { name: "A", description: "" }),
      deleteLandingTemplate("lpgt_AAAAAAAAAAA1"),
      replaceLandingDraftWithTemplate("lpg_AAAAAAAAAAA1", "lpgt_AAAAAAAAAAA1"),
      loadLandingTemplateVersions("lpgt_AAAAAAAAAAA1"),
      loadLandingTemplateOutline("lpgtv_AAAAAAAAAAA1"),
      createLandingPage({ title: "A", template: "lpgt_AAAAAAAAAAA1" }),
    ]);
    for (const result of results) expect(result).toEqual({ error: "Not authorized" });
    expect(state.dataset.landingPageTemplates).toEqual([]);
    expect(state.dataset.landingPages).toEqual([]);
  });
});

describe("saveLandingTemplate", () => {
  it("saves a new template as version 1, cleaned like a save, and publishes and changes nothing else", async () => {
    const result = await saveLandingTemplate(doc("Hello", { type: "RichText", props: { id: "r", html: "<p>Hi</p><script>x</script>", align: "left" } }), { name: "  Spring launch ", description: " A start ", note: "first" });

    expect(result).toEqual({ templateId: expect.stringMatching(/^lpgt_/), name: "Spring launch", version: 1 });
    const template = (await state.repos.landingTemplates.byId(result.templateId!))!;
    expect(template).toMatchObject({ name: "Spring launch", description: "A start", current_version: 1 });
    expect(JSON.stringify(template.data)).toContain("<p>Hi</p>");
    expect(JSON.stringify(template.data)).not.toContain("script");
    expect(state.dataset.landingPages).toEqual([]);
    expect(revalidated).toContain("/admin/pages");
  });

  it("overwrites as version 2 and keeps version 1, with the note", async () => {
    const first = await saveLandingTemplate(doc("One"), { name: "Kit" });

    const second = await saveLandingTemplate(doc("Two"), { overwriteId: first.templateId, description: "Better", note: "A better headline" });

    expect(second).toEqual({ templateId: first.templateId, name: "Kit", version: 2 });
    const versions = await state.repos.landingTemplates.versions(first.templateId!);
    expect(versions.map((v) => [v.version, v.kind, v.note])).toEqual([[2, "overwritten", "A better headline"], [1, "created", null]]);
    expect(JSON.stringify((await state.repos.landingTemplates.versionData(versions[1].id))?.data)).toContain("One");
    expect(JSON.stringify((await state.repos.landingTemplates.byId(first.templateId!))?.data)).toContain("Two");
  });

  it("refuses a name another template has, a missing name, an empty page, a long note and a template that is gone", async () => {
    await saveLandingTemplate(doc(), { name: "Kit" });
    expect((await saveLandingTemplate(doc(), { name: " kit " })).error).toContain("already exists");
    expect(await saveLandingTemplate(doc(), { name: "  " })).toEqual({ error: "Give the template a name." });
    expect((await saveLandingTemplate({ content: [], root: {} }, { name: "Blank" })).error).toContain("empty");
    expect((await saveLandingTemplate(doc(), { name: "Noted", note: "x".repeat(501) })).error).toContain("note");
    expect((await saveLandingTemplate(doc(), { name: "x".repeat(81) })).error).toContain("name");
    expect(await saveLandingTemplate(doc(), { overwriteId: "lpgt_AAAAAAAAAAA1" })).toEqual({ error: "That template no longer exists." });
    expect(await saveLandingTemplate(doc(), { overwriteId: "not-an-id" })).toEqual({ error: "That template no longer exists." });
    expect(state.dataset.landingPageTemplates).toHaveLength(1);
  });

  it("refuses a page over the size cap", async () => {
    const big = doc("Big", { type: "RichText", props: { id: "r", html: `<p>${"x".repeat(2_100_000)}</p>`, align: "left" } });
    expect((await saveLandingTemplate(big, { name: "Big" })).error).toContain("too large");
    expect(state.dataset.landingPageTemplates).toEqual([]);
  });

  it("reports a failure calmly, without the database's words", async () => {
    vi.spyOn(state.repos.landingTemplates, "save").mockRejectedValueOnce(new Error('relation "landing_page_templates" does not exist'));
    const result = await saveLandingTemplate(doc(), { name: "Kit" });
    expect(result).toEqual({ error: "Couldn't save the template." });
  });
});

describe("restoring, renaming and deleting", () => {
  it("brings a version back as a new version, keeping every old one", async () => {
    const first = await saveLandingTemplate(doc("One"), { name: "Kit" });
    await saveLandingTemplate(doc("Two"), { overwriteId: first.templateId });
    const [, v1] = await state.repos.landingTemplates.versions(first.templateId!);

    const restored = await restoreLandingTemplateVersion(v1.id);

    expect(restored).toEqual({ templateId: first.templateId, name: "Kit", version: 3 });
    expect((await state.repos.landingTemplates.versions(first.templateId!)).map((v) => [v.version, v.kind])).toEqual([[3, "restored"], [2, "overwritten"], [1, "created"]]);
    expect(JSON.stringify((await state.repos.landingTemplates.byId(first.templateId!))?.data)).toContain("One");
    expect(await restoreLandingTemplateVersion("lpgtv_AAAAAAAAAAA1")).toEqual({ error: "That version no longer exists." });
    expect(await restoreLandingTemplateVersion("nope")).toEqual({ error: "That version no longer exists." });
  });

  it("renames without a new version and refuses a name that is taken or blank", async () => {
    const a = await saveLandingTemplate(doc(), { name: "Kit" });
    await saveLandingTemplate(doc(), { name: "Other" });

    expect(await updateLandingTemplateDetails(a.templateId!, { name: "Kit two", description: "Words" })).toEqual({ templateId: a.templateId, name: "Kit two", version: 1 });
    expect((await state.repos.landingTemplates.versions(a.templateId!)).length).toBe(1);
    expect((await updateLandingTemplateDetails(a.templateId!, { name: "other", description: "" })).error).toContain("already exists");
    expect(await updateLandingTemplateDetails(a.templateId!, { name: " ", description: "" })).toEqual({ error: "Give the template a name." });
    expect((await updateLandingTemplateDetails(a.templateId!, { name: "x".repeat(81), description: "" })).error).toContain("name");
    expect((await updateLandingTemplateDetails(a.templateId!, { name: "Fine", description: "x".repeat(501) })).error).toContain("description");
    expect(await updateLandingTemplateDetails("lpgt_AAAAAAAAAAA1", { name: "Fine", description: "" })).toEqual({ error: "That template no longer exists." });
  });

  it("deletes softly: gone from the lists, its versions kept, its name free, pages made from it untouched", async () => {
    const saved = await saveLandingTemplate(doc("One"), { name: "Kit" });
    await createLandingPage({ title: "From kit", slug: "from-kit", template: saved.templateId });

    expect(await deleteLandingTemplate(saved.templateId!)).toEqual({});

    expect(await state.repos.landingTemplates.list()).toEqual([]);
    expect(state.dataset.landingPageTemplates[0].deleted_at).toEqual(expect.any(String));
    expect(state.dataset.landingPageTemplateVersions).toHaveLength(1);
    expect(await state.repos.landingPages.bySlug("from-kit")).not.toBeNull();
    expect((await saveLandingTemplate(doc(), { name: "Kit" })).version).toBe(1);
    expect(await deleteLandingTemplate(saved.templateId!)).toEqual({ error: "That template no longer exists." });
    expect(await deleteLandingTemplate("nope")).toEqual({ error: "That template no longer exists." });
  });
});

describe("reading a template's history", () => {
  it("lists versions newest first with who saved them, and counts the blocks of one", async () => {
    const saved = await saveLandingTemplate(doc("One", heading("Two")), { name: "Kit", note: "first" });
    await saveLandingTemplate(doc("Three"), { overwriteId: saved.templateId });

    const listed = await loadLandingTemplateVersions(saved.templateId!);

    expect(listed.versions?.map((v) => [v.version, v.kind, v.note, v.by])).toEqual([[2, "overwritten", null, "An admin"], [1, "created", "first", "An admin"]]);
    const first = listed.versions![1];
    expect(await loadLandingTemplateOutline(first.id)).toEqual({ blocks: [{ type: "Heading", count: 2 }] });
    expect(await loadLandingTemplateVersions("lpgt_AAAAAAAAAAA1")).toEqual({ error: "That template no longer exists." });
    expect(await loadLandingTemplateOutline("lpgtv_AAAAAAAAAAA1")).toEqual({ error: "That version no longer exists." });
    expect(await loadLandingTemplateVersions("nope")).toEqual({ error: "That template no longer exists." });
    expect(await loadLandingTemplateOutline("nope")).toEqual({ error: "That version no longer exists." });
  });
});

describe("using a template", () => {
  it("makes a draft page from it, never published, cleaned again as it is used", async () => {
    const saved = await saveLandingTemplate(doc("Kit headline"), { name: "Kit" });
    // Whatever the database holds, what is used is cleaned again.
    state.dataset.landingPageTemplates[0].data = { content: [{ type: "RichText", props: { id: "r", html: "<p>Hi</p><script>x</script>", align: "left" } }], root: {} };

    expect(await createLandingPage({ title: "From kit", slug: "from-kit", template: saved.templateId })).toEqual({ slug: "from-kit" });

    const page = (await state.repos.landingPages.bySlug("from-kit"))!;
    expect(page).toMatchObject({ status: "draft", published_data: null, title: "From kit" });
    expect(JSON.stringify(page.draft_data)).toContain("<p>Hi</p>");
    expect(JSON.stringify(page.draft_data)).not.toContain("script");
    expect(await createLandingPage({ title: "X", template: "lpgt_AAAAAAAAAAA1" })).toEqual({ error: "That template no longer exists." });
    expect(await createLandingPage({ title: "X", template: "nope" })).toEqual({ error: "That template no longer exists." });
    expect(state.dataset.landingPages).toHaveLength(1);
  });

  it("replaces a page's draft, keeping the previous draft in History and leaving the published copy, title and address alone", async () => {
    const saved = await saveLandingTemplate(doc("From the template"), { name: "Kit" });
    await createLandingPage({ title: "Live page", slug: "live" });
    const page = (await state.repos.landingPages.bySlug("live"))!;
    await state.repos.landingPages.saveDraft(page.id, { content: [heading("My own words")] as never, root: { props: {} } }, null);
    await state.repos.landingPages.publish(page.id);
    await state.repos.landingPages.saveDraft(page.id, { content: [heading("Unpublished edits")] as never, root: { props: {} } }, null);

    expect(await replaceLandingDraftWithTemplate(page.id, saved.templateId!)).toEqual({ slug: "live" });

    const after = (await state.repos.landingPages.bySlug("live"))!;
    expect(text(after)).toBe("From the template");
    expect(JSON.stringify(after.published_data)).toContain("My own words");
    expect(after).toMatchObject({ title: "Live page", slug: "live", status: "published" });
    const versions = await state.repos.landingPages.versions(page.id);
    expect(versions[0].kind).toBe("before_starter");
    expect(JSON.stringify(await state.repos.landingPages.versionData(versions[0].id))).toContain("Unpublished edits");
  });

  it("refuses a template or page that is gone and changes nothing", async () => {
    await createLandingPage({ title: "Live page", slug: "live" });
    const page = (await state.repos.landingPages.bySlug("live"))!;
    expect(await replaceLandingDraftWithTemplate(page.id, "lpgt_AAAAAAAAAAA1")).toEqual({ error: "That template no longer exists." });
    const saved = await saveLandingTemplate(doc(), { name: "Kit" });
    expect(await replaceLandingDraftWithTemplate("lpg_AAAAAAAAAAA1", saved.templateId!)).toEqual({ error: "That page no longer exists." });
    expect(await replaceLandingDraftWithTemplate("nope", saved.templateId!)).toEqual({ error: "That page no longer exists." });
    expect(await state.repos.landingPages.versions(page.id)).toEqual([]);
  });

  it("reports a failure calmly", async () => {
    const saved = await saveLandingTemplate(doc(), { name: "Kit" });
    await createLandingPage({ title: "Live page", slug: "live" });
    const page = (await state.repos.landingPages.bySlug("live"))!;
    vi.spyOn(state.repos.landingPages, "keepDraftBeforeStarter").mockRejectedValueOnce(new Error("boom"));
    expect(await replaceLandingDraftWithTemplate(page.id, saved.templateId!)).toEqual({ error: "Couldn't replace the draft." });
    vi.spyOn(state.repos.landingTemplates, "byId").mockRejectedValueOnce(new Error("boom"));
    expect(await createLandingPage({ title: "X", template: saved.templateId })).toEqual({ error: "Couldn't create the page." });
  });
});
