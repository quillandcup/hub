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

import { publishSiteTemplate, resetSiteDraft, restoreSiteVersion, saveSiteDraft } from "@/app/(admin)/admin/pages/design/actions";

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
    expect(await restoreSiteVersion("lpstv_AAAAAAAAAAA1")).toEqual({ error: "Not authorized" });
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

  it("makes the favicon public with the rest, and refuses one that is not square or not a picture type", async () => {
    const icon = await state.repos.media.add({ storage_path: `originals/shared/${crypto.randomUUID()}.png`, mime_type: "image/png", width: 64, height: 64, bytes: 1000, sha256: crypto.randomUUID(), title: "Icon", is_public: false });
    expect((await publishSiteTemplate({ ...site("x"), favicon: { assetId: icon.id } })).error).toBeUndefined();
    expect((await state.repos.media.byId(icon.id))?.is_public).toBe(true);
    const wide = await state.repos.media.add({ storage_path: `originals/shared/${crypto.randomUUID()}.png`, mime_type: "image/png", width: 64, height: 32, bytes: 1000, sha256: crypto.randomUUID(), title: "Wide", is_public: false });
    const refused = await publishSiteTemplate({ ...site("y"), favicon: { assetId: wide.id } });
    expect(refused.issues).toEqual(["A favicon has to be square. That picture is 64 by 32 pixels."]);
    expect((await state.repos.landingSiteTemplate.published())?.footer.text).toBe("x");
    const gone = await publishSiteTemplate({ ...site("z"), favicon: { assetId: "mda_Missing00001" } });
    expect(gone.issues).toEqual(["The favicon picture is no longer in the library."]);
  });

  it("saves the style guide cleaned to the lists, and publishes it", async () => {
    await publishSiteTemplate({ ...site("x"), style: { primary: "teal", fontFamily: "Comic Sans", pageBackground: "cream" } });
    const published = await state.repos.landingSiteTemplate.published();
    expect(published?.style).toMatchObject({ primary: "teal", pageBackground: "cream", fontFamily: "default" });
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

  it("is stamped on the row, so the audit trigger logs it as one entry", async () => {
    await publishSiteTemplate(site("live"));
    await saveSiteDraft(site("wip"));
    await resetSiteDraft();
    expect(state.dataset.landingSiteTemplates[0].draft_reset_at).toEqual(expect.any(String));
  });
});

describe("History: publishing keeps a version, bringing one back changes only the draft", () => {
  it("keeps a version at each publish and returns the list, newest first, with who made it as a name", async () => {
    const first = await publishSiteTemplate(site("first"));
    expect(first.versions).toHaveLength(1);
    expect(first.versions?.[0]).toEqual({ id: expect.stringMatching(/^lpstv_/), createdAt: expect.any(String), by: "Someone" });
    const second = await publishSiteTemplate(site("second"));
    expect(second.versions).toHaveLength(2);
    expect(JSON.stringify(second.versions)).not.toContain("00000000-0000-4000-a000-0000000000a1");
    expect(state.dataset.landingSiteTemplateVersions).toHaveLength(2);
  });

  it("keeps no version when a publish is refused", async () => {
    await publishSiteTemplate(site("x", { ...newHeaderItem("cta"), label: "Join", href: "" }));
    expect(state.dataset.landingSiteTemplateVersions).toEqual([]);
  });

  it("puts the version in the draft, leaves what visitors see alone, and says the draft now differs", async () => {
    await publishSiteTemplate(site("old"));
    await publishSiteTemplate(site("new"));
    const oldest = state.dataset.landingSiteTemplateVersions[0];
    const result = await restoreSiteVersion(oldest.id);
    expect(result.site?.footer.text).toBe("old");
    expect(result.unpublished).toBe(true);
    const now = await state.repos.landingSiteTemplate.state();
    expect(now.draft.footer.text).toBe("old");
    expect(now.published?.footer.text).toBe("new");
    expect(state.dataset.landingSiteTemplateVersions).toHaveLength(2);
    expect(state.dataset.landingSiteTemplates[0].restored_from_version_id).toBe(oldest.id);
    expect(revalidated).toContain("/admin/pages");
  });

  it("says the draft is the live copy when the version brought back is the one that is live", async () => {
    await publishSiteTemplate(site("live"));
    expect((await restoreSiteVersion(state.dataset.landingSiteTemplateVersions[0].id)).unpublished).toBe(false);
  });

  it("refuses an id that isn't a site version, and one that no longer exists", async () => {
    await saveSiteDraft(site("wip"));
    expect((await restoreSiteVersion("lpgv_AAAAAAAAAAA1")).error).toBe("That version no longer exists.");
    expect((await restoreSiteVersion("lpstv_AAAAAAAAAAA1")).error).toBe("That version no longer exists.");
    expect((await state.repos.landingSiteTemplate.state()).draft.footer.text).toBe("wip");
  });

  it("refuses someone who isn't an admin", async () => {
    await publishSiteTemplate(site("live"));
    state.admin = false;
    expect(await restoreSiteVersion(state.dataset.landingSiteTemplateVersions[0].id)).toEqual({ error: "Not authorized" });
  });

  it("says it couldn't, without the database's message, when the database fails", async () => {
    vi.spyOn(state.repos.landingSiteTemplate, "restoreVersion").mockRejectedValueOnce(new Error("relation exploded"));
    const result = await restoreSiteVersion("lpstv_AAAAAAAAAAA1");
    expect(result.error).toContain("Couldn't bring that version back");
    expect(result.error).not.toContain("exploded");
  });
});
