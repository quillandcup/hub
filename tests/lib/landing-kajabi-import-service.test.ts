import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { collectAssetIds } from "@/lib/landing/data";
import { layoutKeyOf } from "@/lib/landing/kajabi-import";
import { importKajabiExport, inspectKajabiExport, matchOf, sameDocument, type FetchPicture, type ImportTarget } from "@/lib/landing/kajabi-import-service";
import { block, exportSettings, exportZip, PNG_1X1 } from "@/tests/helpers/kajabi-export";

let dataset: InMemoryDataset;
let repos: Repos;
const uploads: string[] = [];
const storage = { from: () => ({ upload: async (path: string) => (uploads.push(path), { error: null }) }) } as never;
const cdn: FetchPicture = async () => ({ bytes: Buffer.from(PNG_1X1) });
const USER = "00000000-0000-4000-a000-0000000000a1";

const run = (over: { zip?: Uint8Array; title?: string; target?: ImportTarget; fetchPicture?: FetchPicture } = {}) =>
  importKajabiExport(
    { pages: repos.landingPages, media: repos.media, storage, fetchPicture: over.fetchPicture ?? cdn, lookupFetchers: { finalUrl: async () => null, html: async () => null } },
    { archive: over.zip ?? exportZip(), title: over.title ?? "Example Sprint", target: over.target, userId: USER, year: 2031 },
  );

type Sections = Record<string, { block_order: string[]; blocks: Record<string, { type: string; settings: Record<string, unknown> }> }>;
const settingsWith = (change: (sections: Sections) => void) => {
  const settings = exportSettings();
  change(settings.current.sections as unknown as Sections);
  return settings;
};
/** The same layout with other words. */
const reworded = (text: string) =>
  exportZip(
    settingsWith((s) => {
      s.main_section.blocks["1600000000100_0"].settings.text = `<h1>${text}</h1><p>Body.</p>`;
    }),
  );
/** Another page that shares the first section and the earliest block with the default one (made from the same Kajabi page), with one more block. */
const longerPage = () =>
  exportZip(
    settingsWith((s) => {
      s.main_section.blocks["1600000000800_0"] = block("text", { text: "<p>Extra</p>" }) as never;
      s.main_section.block_order.push("1600000000800_0");
    }),
  );
const pageOf = async (slug: string) => (await repos.landingPages.bySlug(slug))!;

beforeEach(() => {
  dataset = new InMemoryDataset();
  repos = createInMemoryRepos(dataset);
  uploads.length = 0;
});

describe("importKajabiExport: a new page", () => {
  it("creates an unpublished draft with its pictures in the media library, private", async () => {
    const outcome = await run();

    expect(outcome).toMatchObject({ status: "imported", action: "created", slug: "example-sprint", title: "Example Sprint", published: false, keptBefore: false });
    const page = await repos.landingPages.bySlug("example-sprint");
    expect(page).toMatchObject({ status: "draft", published_data: null, import_key: expect.stringMatching(/^kajabi2:[0-9a-f]{32}$/), created_by: USER });
    const ids = collectAssetIds(page!.draft_data);
    expect(ids).toHaveLength(1); // both pictures are the same bytes: one library image
    for (const id of ids) expect(await repos.media.byId(id)).toMatchObject({ is_public: false, source: "kajabi", tags: ["imported"] });
    expect(JSON.stringify(page!.draft_data)).not.toContain("kajabi-import-picture");
  });

  it("reports what was left out, hidden, approximated or still to do, and what must be fixed before publishing", async () => {
    const outcome = await run();
    if (outcome.status !== "imported") throw new Error("expected an import");
    expect(outcome.notes.map((n) => n.kind)).toEqual(expect.arrayContaining(["todo", "hidden", "approximated"]));
    expect(outcome.counts).toEqual({ blocks: 10, hidden: 1, pictures: 2, picturesFailed: 0 });
    expect(outcome.issues.some((i) => i.severity === "error")).toBe(true); // pictures with no description
  });

  it("gives a numbered address when the title's is taken, never overwriting the other page", async () => {
    await repos.landingPages.create({ title: "Other", slug: "example-sprint", createdBy: null });
    const outcome = await run();
    expect(outcome).toMatchObject({ status: "imported", slug: "example-sprint-2" });
    expect((await repos.landingPages.bySlug("example-sprint"))?.title).toBe("Other");
  });

  it("needs a title, because the export has none", async () => {
    expect(await run({ title: "  " })).toEqual({ status: "error", error: "Give the page a title: the export doesn't have one." });
    expect(await run({ title: "", target: { kind: "new" } })).toEqual({ status: "error", error: "Give the page a title: the export doesn't have one." });
    expect(dataset.landingPages).toEqual([]);
  });

  it("imports without a picture it can't get, and says which", async () => {
    const outcome = await run({ fetchPicture: async () => ({ error: "not on the Kajabi picture host" }) });
    if (outcome.status !== "imported") throw new Error("expected an import");
    expect(outcome.counts.pictures).toBe(1); // the one inside the export
    expect(outcome.counts.picturesFailed).toBe(1);
    expect(outcome.notes.some((n) => n.kind === "left_out" && n.text.includes("Picture 1 couldn't be imported"))).toBe(true);
  });

  it("answers an error for a file that isn't a page export, writing nothing", async () => {
    expect(await run({ zip: new Uint8Array([1, 2, 3]) })).toMatchObject({ status: "error" });
    expect(await run({ zip: exportZip({ nothing: true }) })).toMatchObject({ status: "error", error: expect.stringContaining("page export") });
    expect(dataset.landingPages).toEqual([]);
  });
});

describe("importKajabiExport: the same page again", () => {
  it("asks which it is when a page has the layout, and writes nothing until it is chosen", async () => {
    await run();
    const before = await pageOf("example-sprint");

    const asked = await run({ zip: reworded("Another headline") });

    if (asked.status !== "choose") throw new Error("expected a question");
    expect(asked.matches).toEqual([{ id: before.id, title: "Example Sprint", slug: "example-sprint", draftHeading: "Write a little, every day", published: false, edited: false, unpublishedChanges: false }]);
    expect(asked.pages).toEqual([{ id: before.id, title: "Example Sprint", slug: "example-sprint" }]);
    expect(dataset.landingPages).toHaveLength(1);
    expect(await pageOf("example-sprint")).toEqual(before);
    expect(await repos.landingPages.versions(before.id)).toEqual([]);
  });

  it("asks even when the draft is as the last import left it", async () => {
    await run();
    expect(await run()).toMatchObject({ status: "choose" });
  });

  it("replaces only the draft when told to: the published copy, versions, title, address and key stay", async () => {
    await run();
    const first = await pageOf("example-sprint");
    await repos.landingPages.publish(first.id);
    const live = (await repos.landingPages.published("example-sprint"))!.data;
    const settings = settingsWith((s) => {
      s.main_section.blocks["1600000000200_0"].settings.btn_text = "A new label";
    });

    const outcome = await run({ zip: exportZip(settings), title: "Ignored for a replace", target: { kind: "replace", pageId: first.id } });

    expect(outcome).toMatchObject({ status: "imported", action: "updated", slug: "example-sprint", title: "Example Sprint", published: true });
    const after = await pageOf("example-sprint");
    expect(after.id).toBe(first.id);
    expect(after.import_key).toBe(first.import_key);
    expect(dataset.landingPages).toHaveLength(1);
    expect(JSON.stringify(after.draft_data)).toContain("A new label");
    expect(after.published_data).toEqual(first.draft_data);
    expect((await repos.landingPages.published("example-sprint"))!.data).toEqual(live);
    // One published version, and the replaced draft kept as a "before import" one.
    const versions = await repos.landingPages.versions(first.id);
    expect(versions.map((v) => v.kind).sort()).toEqual(["before_import", "published"]);
    const kept = versions.find((v) => v.kind === "before_import")!;
    expect(kept.note).toBe("Replaced by a Kajabi import");
    expect(JSON.stringify(await repos.landingPages.versionData(kept.id))).not.toContain("A new label");
  });

  it("keeps an edited draft in the history when it is replaced, and brings it back", async () => {
    await run();
    const page = await pageOf("example-sprint");
    await new Promise((r) => setTimeout(r, 5));
    await repos.landingPages.saveDraft(page.id, { content: [{ type: "Heading", props: { id: "h", text: "My own edit", level: "h1", align: "center" } }], root: {} }, USER);
    expect(matchOf(await pageOf("example-sprint"))).toMatchObject({ edited: true, draftHeading: "My own edit" });

    const done = await run({ target: { kind: "replace", pageId: page.id } });

    expect(done).toMatchObject({ status: "imported", action: "updated", keptBefore: true });
    const kept = (await repos.landingPages.versions(page.id)).find((v) => v.kind === "before_import")!;
    expect(JSON.stringify(await repos.landingPages.versionData(kept.id))).toContain("My own edit");
    await repos.landingPages.restoreVersion(kept.id);
    expect(JSON.stringify((await pageOf("example-sprint")).draft_data)).toContain("My own edit");
  });

  it("says when the draft holds changes that are not live", async () => {
    await run();
    const page = await pageOf("example-sprint");
    await repos.landingPages.publish(page.id);
    expect(matchOf(await pageOf("example-sprint"))).toMatchObject({ published: true, edited: false, unpublishedChanges: false });
    await new Promise((r) => setTimeout(r, 5));
    await repos.landingPages.saveDraft(page.id, { content: [], root: {} }, USER);
    expect(matchOf(await pageOf("example-sprint"))).toMatchObject({ published: true, unpublishedChanges: true });
  });

  it("reuses the pictures it already has instead of adding them again", async () => {
    await run();
    const before = dataset.mediaAssets.length;
    await run({ target: { kind: "replace", pageId: (await pageOf("example-sprint")).id } });
    expect(dataset.mediaAssets).toHaveLength(before);
  });

  it("imports as a new page on request even when a page has the layout, and gives it a numbered key so each keeps its own", async () => {
    await run();
    const first = await pageOf("example-sprint");

    const outcome = await run({ title: "Cloned Sprint", target: { kind: "new" } });

    expect(outcome).toMatchObject({ status: "imported", action: "created", slug: "cloned-sprint" });
    const second = await pageOf("cloned-sprint");
    expect(second.id).not.toBe(first.id);
    expect(second.import_key).toBe(`${first.import_key}#2`);
    expect(await pageOf("example-sprint")).toEqual(first);
    // Both look like the next export of that layout, and both are offered.
    const asked = await run({ zip: reworded("Third") });
    if (asked.status !== "choose") throw new Error("expected a question");
    expect(asked.matches.map((m) => m.slug).sort()).toEqual(["cloned-sprint", "example-sprint"]);
  });
});

describe("importKajabiExport: different pages that share ids", () => {
  it("does not take a page with the same first section and earliest block for the one already imported", async () => {
    await run();
    const first = await pageOf("example-sprint");

    const outcome = await run({ zip: longerPage(), title: "Second Page" });

    expect(outcome).toMatchObject({ status: "imported", action: "created", slug: "second-page" });
    expect(await pageOf("example-sprint")).toEqual(first);
    expect(dataset.landingPages).toHaveLength(2);
    expect((await pageOf("second-page")).import_key).not.toBe(first.import_key);
  });

  it("finds each page again by its own layout", async () => {
    await run();
    await run({ zip: longerPage(), title: "Second Page" });
    const again = await inspectKajabiExport({ pages: repos.landingPages }, { archive: longerPage(), year: 2031 });
    if (again.status !== "inspected") throw new Error("expected an inspection");
    expect(again.matches.map((m) => m.slug)).toEqual(["second-page"]);
  });
});

describe("importKajabiExport: a page imported under the first key format", () => {
  const OLD_KEY = "kajabi:main_section:1600000000100_0";
  beforeEach(async () => {
    await repos.landingPages.create({ title: "Old Import", slug: "old-import", createdBy: null, importKey: OLD_KEY });
  });

  it("is never matched: the export becomes a new page without a question, and the old page is offered for a replace", async () => {
    const inspected = await inspectKajabiExport({ pages: repos.landingPages }, { archive: exportZip(), year: 2031 });
    if (inspected.status !== "inspected") throw new Error("expected an inspection");
    expect(inspected.matches).toEqual([]);
    expect(inspected.pages.map((p) => p.slug)).toEqual(["old-import"]);

    const outcome = await run();
    expect(outcome).toMatchObject({ status: "imported", action: "created", slug: "example-sprint" });
    expect((await pageOf("old-import")).import_key).toBe(OLD_KEY);
  });

  it("takes the new key when the admin chooses to replace it, keeping its title and address", async () => {
    const old = await pageOf("old-import");

    const outcome = await run({ target: { kind: "replace", pageId: old.id } });

    expect(outcome).toMatchObject({ status: "imported", action: "updated", slug: "old-import", title: "Old Import" });
    expect((await pageOf("old-import")).import_key).toMatch(/^kajabi2:/);
    // Now its next export is found.
    const asked = await run({ zip: reworded("Again") });
    expect(asked).toMatchObject({ status: "choose", matches: [{ slug: "old-import" }] });
  });
});

describe("importKajabiExport: what may be replaced", () => {
  it("refuses a page that is gone, a template and a page the Hub built, writing nothing", async () => {
    const built = await repos.landingPages.create({ title: "Built here", slug: "built-here", data: { content: [], root: {} }, createdBy: null });
    const template = await repos.landingPages.create({ title: "A template", slug: "a-template", createdBy: null, kind: "template", importKey: "kajabi2:x" });
    expect(await run({ target: { kind: "replace", pageId: built.id } })).toEqual({ status: "error", error: "Only a page made by an import can be replaced by one." });
    expect(await run({ target: { kind: "replace", pageId: template.id } })).toEqual({ status: "error", error: "That page no longer exists." });
    expect(await run({ target: { kind: "replace", pageId: "lpg_doesNotExist" } })).toEqual({ status: "error", error: "That page no longer exists." });
    expect(dataset.landingPages).toHaveLength(2);
    expect(dataset.mediaAssets).toHaveLength(0);
  });
});

describe("inspectKajabiExport", () => {
  it("tells what the export starts with and a title to use, and writes nothing", async () => {
    const outcome = await inspectKajabiExport({ pages: repos.landingPages }, { archive: exportZip(), year: 2031 });

    expect(outcome).toEqual({
      status: "inspected",
      start: { heading: "Write a little, every day", lines: ["Join the Example Sprint & see.", "Second paragraph.", "Short line."] },
      suggestedTitle: "Write a little, every day",
      blocks: 10,
      countdowns: 0,
      matches: [],
      pages: [],
    });
    expect(dataset.landingPages).toEqual([]);
    expect(dataset.mediaAssets).toEqual([]);
  });

  it("says a file that is not an export is one", async () => {
    expect(await inspectKajabiExport({ pages: repos.landingPages }, { archive: new Uint8Array([1, 2, 3]), year: 2031 })).toMatchObject({ status: "error" });
    expect(await inspectKajabiExport({ pages: repos.landingPages }, { archive: exportZip({ nothing: true }), year: 2031 })).toMatchObject({ status: "error" });
  });
});

describe("sameDocument and layoutKeyOf", () => {
  it("compares documents whatever order their keys are in", () => {
    expect(sameDocument({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameDocument({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("builds a key from the layout", () => {
    expect(layoutKeyOf("abc")).toBe("kajabi2:abc");
  });
});
