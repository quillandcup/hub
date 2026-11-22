import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const state: { admin: boolean; repos: Repos } = { admin: true, repos: undefined as never };
const recorded: { action: string; outcome: unknown }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/analytics/server", () => ({
  withAction: async (action: string, run: () => Promise<{ error?: string }>, classify?: (r: { error?: string }) => unknown) => {
    const result = await run();
    recorded.push({ action, outcome: classify ? classify(result) : { ok: !result.error } });
    return result;
  },
}));
vi.mock("@/lib/admin-auth", () => ({
  requireActionPermission: async () => (state.admin ? { ok: true, user: { id: "00000000-0000-4000-a000-0000000000a1", email: "admin@example.test" }, supabase: {} } : { ok: false, error: "Not authorized" }),
}));
vi.mock("@/lib/landing/ai", () => ({ aiConfigured: () => false, generateLandingPage: async () => undefined, reviseLandingPage: async () => undefined }));
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));

import { createLandingPage, createLandingPageFromJson } from "@/app/(admin)/admin/pages/actions";

const heading = { type: "Heading", props: { id: "h", text: "Welcome", level: "h1", align: "center" } };
const doc = (...blocks: unknown[]) => ({ content: [heading, ...blocks], root: { props: {} } });
const file = (data: unknown = doc(), over: Record<string, unknown> = {}) => JSON.stringify({ format: "hedgie-landing-page", version: 1, slug: "elsewhere", title: "Elsewhere", kind: "draft", exportedAt: "2026-11-21T15:00:00Z", data, ...over });
const pages = async () => (await state.repos.landingPages.list("page")).length;

beforeEach(() => {
  state.admin = true;
  state.repos = createInMemoryRepos(new InMemoryDataset());
  recorded.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createLandingPageFromJson", () => {
  it("refuses someone who isn't an admin, for the preview and the page, and makes nothing", async () => {
    state.admin = false;
    expect(await createLandingPageFromJson({ text: file(), title: "A", pageType: "website" })).toEqual({ error: "Not authorized" });
    expect(await createLandingPageFromJson({ text: file() }, { dryRun: true })).toEqual({ error: "Not authorized" });
    expect(await pages()).toBe(0);
  });

  it("previews without a title or kind and writes nothing", async () => {
    const result = await createLandingPageFromJson({ text: file(doc({ type: "Widget", props: {} })) }, { dryRun: true });
    expect(result.slug).toBeUndefined();
    expect(result.summary).toMatchObject({ blocksBefore: 0, blocksAfter: 1, identical: false, leftOut: [{ type: "Widget", count: 1 }], source: { title: "Elsewhere" } });
    expect(await pages()).toBe(0);
    expect(recorded.at(-1)).toEqual({ action: "landing_page_created_from_file", outcome: { ok: true, detail: "preview" } });
  });

  it("makes a draft page of the chosen kind from the cleaned file, stamped as made from a file", async () => {
    const result = await createLandingPageFromJson({ text: file(doc({ type: "Widget", props: {} })), title: " Spring sprint ", slug: "", pageType: "website" });
    expect(result.slug).toBe("spring-sprint");
    const page = (await state.repos.landingPages.bySlug("spring-sprint"))!;
    expect(page).toMatchObject({ title: "Spring sprint", kind: "page", page_type: "website", status: "draft", published_data: null });
    expect(page.replaced_at).toBeTruthy();
    expect(JSON.stringify(page.draft_data)).toContain("Welcome");
    expect(JSON.stringify(page.draft_data)).not.toContain("Widget");
    expect(recorded.at(-1)).toEqual({ action: "landing_page_created_from_file", outcome: { ok: true, detail: undefined } });
  });

  it("accepts a bare document without the wrapper", async () => {
    expect((await createLandingPageFromJson({ text: JSON.stringify(doc()), title: "Bare", pageType: "landing" })).slug).toBe("bare");
  });

  it("refuses a file that isn't a page and leaves no page behind", async () => {
    for (const text of ["{ nope", JSON.stringify({ format: "other", data: doc() }), JSON.stringify({ root: {} }), " ".repeat(2_000_001), undefined as never]) {
      expect((await createLandingPageFromJson({ text, title: "A", pageType: "landing" })).error).toBeTruthy();
    }
    expect(await pages()).toBe(0);
    expect(recorded.every((r) => (r.outcome as { ok: boolean }).ok === false)).toBe(true);
  });

  it("refuses an unknown or missing kind of page, and a missing title or bad address, before making anything", async () => {
    expect(await createLandingPageFromJson({ text: file(), title: "A", pageType: "newsletter" })).toEqual({ error: "Choose a website page or a landing page." });
    expect(await createLandingPageFromJson({ text: file(), title: "A" })).toEqual({ error: "Choose a website page or a landing page." });
    expect(await createLandingPageFromJson({ text: file(), title: "  ", pageType: "landing" })).toEqual({ error: "Give the page a title." });
    expect((await createLandingPageFromJson({ text: file(), title: "A", slug: "Not Valid", pageType: "landing" })).error).toMatch(/lowercase letters/);
    expect(await pages()).toBe(0);
  });

  it("says when the address is taken and keeps the other page as it was", async () => {
    await createLandingPage({ title: "Existing", slug: "taken" });
    const result = await createLandingPageFromJson({ text: file(), title: "New", slug: "taken", pageType: "landing" });
    expect(result).toEqual({ error: "Another page already has that address." });
    expect(await pages()).toBe(1);
    expect((await state.repos.landingPages.bySlug("taken"))!.title).toBe("Existing");
  });

  it("clears a picture that isn't in this library", async () => {
    const text = file(doc({ type: "Image", props: { id: "i", imageAssetId: "med_AAAAAAAAAAA1", alt: "x" } }));
    const preview = await createLandingPageFromJson({ text }, { dryRun: true });
    expect(preview.summary?.removedPictures).toBe(1);
    await createLandingPageFromJson({ text, title: "Pic", pageType: "landing" });
    expect(JSON.stringify((await state.repos.landingPages.bySlug("pic"))!.draft_data)).not.toContain("med_AAAAAAAAAAA1");
  });

  it("reports an unexpected failure plainly and writes nothing", async () => {
    vi.spyOn(state.repos.landingPages, "create").mockRejectedValueOnce(new Error("db down"));
    expect(await createLandingPageFromJson({ text: file(), title: "A", pageType: "landing" })).toEqual({ error: "Couldn't create the page." });
    expect(await pages()).toBe(0);
  });
});
