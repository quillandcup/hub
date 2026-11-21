import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { newHeaderItem } from "@/lib/landing/site-template";

const state: { admin: boolean; repos: Repos; dataset: InMemoryDataset } = { admin: true, repos: undefined as never, dataset: undefined as never };
const revalidated: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => (state.admin ? { ok: true, user: { id: "00000000-0000-4000-a000-0000000000a1", email: "admin@example.test" }, supabase: {} } : { ok: false, error: "Not authorized" }),
}));
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));

import { publishSiteTemplate, resetSiteDraft, saveSiteDraft } from "@/app/(admin)/admin/pages/design/actions";

const site = (footerText: string, ...items: unknown[]) => ({ header: { show: true, items }, footer: { show: true, text: footerText } });
const logo = (assetId: string, alt = "Quill and Cup") => ({ ...newHeaderItem("logo"), logoAssetId: assetId, alt });

async function asset() {
  return state.repos.media.add({ storage_path: `originals/shared/${crypto.randomUUID()}.png`, mime_type: "image/png", width: 800, height: 600, bytes: 1000, sha256: crypto.randomUUID(), title: "Logo", is_public: false });
}

beforeEach(() => {
  state.admin = true;
  state.dataset = new InMemoryDataset();
  state.repos = createInMemoryRepos(state.dataset);
  revalidated.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("who may change the site design", () => {
  it("refuses everything to someone who isn't an admin, and writes nothing", async () => {
    state.admin = false;
    expect(await saveSiteDraft(site("x"))).toEqual({ error: "Not authorized" });
    expect(await publishSiteTemplate(site("x"))).toEqual({ error: "Not authorized" });
    expect(await resetSiteDraft()).toEqual({ error: "Not authorized" });
    expect(state.dataset.landingSiteTemplates).toEqual([]);
  });
});

describe("saveSiteDraft (autosave)", () => {
  it("saves a cleaned draft and leaves what is published alone", async () => {
    await publishSiteTemplate(site("live"));
    const saved = await saveSiteDraft({ header: { show: true, items: [{ type: "cta", label: "Join", href: "javascript:alert(1)" }, { type: "script" }] }, footer: { show: true, text: "draft", evil: "<script>" } });
    expect(saved.savedAt).toEqual(expect.any(String));
    const state_ = await state.repos.landingSiteTemplate.state();
    expect(state_.draft.header.items).toHaveLength(1);
    expect(state_.draft.header.items[0]).toMatchObject({ type: "cta", href: "" });
    expect(JSON.stringify(state_.draft)).not.toContain("evil");
    expect(state_.published?.footer.text).toBe("live");
  });

  it("refuses a document that is too large", async () => {
    expect((await saveSiteDraft({ footer: { text: "x".repeat(200_000) } })).error).toContain("too large");
    expect(state.dataset.landingSiteTemplates).toEqual([]);
  });

  it("says it couldn't save, without the database's message, when the database fails", async () => {
    vi.spyOn(state.repos.landingSiteTemplate, "saveDraft").mockRejectedValueOnce(new Error("relation exploded"));
    const result = await saveSiteDraft(site("x"));
    expect(result.error).toContain("Couldn't save");
    expect(result.error).not.toContain("exploded");
  });
});

describe("publishSiteTemplate", () => {
  it("publishes what is shown, for every website page, and makes the logo public", async () => {
    const picture = await asset();
    const result = await publishSiteTemplate(site("Fern Quills", logo(picture.id)));
    expect(result.publishedAt).toEqual(expect.any(String));
    const published = await state.repos.landingSiteTemplate.published();
    expect(published?.footer.text).toBe("Fern Quills");
    expect((await state.repos.media.byId(picture.id))?.is_public).toBe(true);
    expect(revalidated).toContain("/admin/pages");
  });

  it("stops on a problem a visitor would meet, and publishes nothing", async () => {
    const result = await publishSiteTemplate(site("x", { ...newHeaderItem("cta"), label: "Join", href: "" }));
    expect(result.error).toBe("Fix these before publishing.");
    expect(result.issues).toEqual(["The header button needs a label and a link."]);
    expect(await state.repos.landingSiteTemplate.published()).toBeNull();
  });

  it("changes nothing a visitor sees until it is published again", async () => {
    await publishSiteTemplate(site("first"));
    await saveSiteDraft(site("second"));
    expect((await state.repos.landingSiteTemplate.published())?.footer.text).toBe("first");
    await publishSiteTemplate(site("second"));
    expect((await state.repos.landingSiteTemplate.published())?.footer.text).toBe("second");
  });
});

describe("resetSiteDraft", () => {
  it("goes back to the published copy without publishing anything", async () => {
    await publishSiteTemplate(site("live"));
    await saveSiteDraft(site("wip"));
    const result = await resetSiteDraft();
    expect(result.site?.footer.text).toBe("live");
    expect((await state.repos.landingSiteTemplate.state()).draft.footer.text).toBe("live");
  });

  it("has nothing to go back to before the first publish", async () => {
    await saveSiteDraft(site("wip"));
    expect((await resetSiteDraft()).error).toContain("no published site design");
  });
});
