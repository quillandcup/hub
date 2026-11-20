import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { collectAssetIds } from "@/lib/landing/data";
import { importKajabiExport, replaceReasons, sameDocument, type FetchPicture } from "@/lib/landing/kajabi-import-service";
import { exportSettings, exportZip, PNG_1X1 } from "@/tests/helpers/kajabi-export";

let dataset: InMemoryDataset;
let repos: Repos;
const uploads: string[] = [];
const storage = { from: () => ({ upload: async (path: string) => (uploads.push(path), { error: null }) }) } as never;
const cdn: FetchPicture = async () => ({ bytes: Buffer.from(PNG_1X1) });
const USER = "00000000-0000-4000-a000-0000000000a1";

const run = (over: { zip?: Uint8Array; title?: string; confirm?: boolean; fetchPicture?: FetchPicture } = {}) =>
  importKajabiExport(
    { pages: repos.landingPages, media: repos.media, storage, fetchPicture: over.fetchPicture ?? cdn },
    { archive: over.zip ?? exportZip(), title: over.title ?? "Example Sprint", confirm: over.confirm ?? false, userId: USER, year: 2031 },
  );

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
    expect(page).toMatchObject({ status: "draft", published_data: null, import_key: "kajabi:main_section:1600000000100_0", created_by: USER });
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
  it("replaces only the draft: the published copy, versions, title and address stay", async () => {
    await run();
    const first = (await repos.landingPages.bySlug("example-sprint"))!;
    await repos.landingPages.publish(first.id);
    const live = (await repos.landingPages.published("example-sprint"))!.data;
    const settings = exportSettings();
    (settings.current.sections as Record<string, { blocks: Record<string, { settings: Record<string, unknown> }> }>).main_section.blocks["1600000000200_0"].settings.btn_text = "A new label";

    const outcome = await run({ zip: exportZip(settings), title: "Example Sprint", confirm: true });

    expect(outcome).toMatchObject({ status: "imported", action: "updated", slug: "example-sprint", published: true });
    const after = (await repos.landingPages.bySlug("example-sprint"))!;
    expect(after.id).toBe(first.id);
    expect(dataset.landingPages).toHaveLength(1);
    expect(JSON.stringify(after.draft_data)).toContain("A new label");
    expect(after.published_data).toEqual(first.draft_data);
    expect((await repos.landingPages.published("example-sprint"))!.data).toEqual(live);
    expect(after).toMatchObject({ title: "Example Sprint", slug: "example-sprint", status: "published" });
    // One published version, and the replaced draft kept as a "before import" one.
    const versions = await repos.landingPages.versions(first.id);
    expect(versions.map((v) => v.kind).sort()).toEqual(["before_import", "published"]);
    const kept = versions.find((v) => v.kind === "before_import")!;
    expect(kept.note).toBe("Replaced by a Kajabi import");
    expect(JSON.stringify(await repos.landingPages.versionData(kept.id))).not.toContain("A new label");
  });

  it("reuses the pictures it already has instead of adding them again", async () => {
    await run();
    const before = dataset.mediaAssets.length;
    await run({ confirm: true });
    expect(dataset.mediaAssets).toHaveLength(before);
  });

  it("does not ask when the draft is as the last import left it, and the page is not live", async () => {
    await run();
    expect(await run()).toMatchObject({ status: "imported", action: "updated", keptBefore: false });
  });

  it("asks before replacing a draft that was edited since the import, and writes nothing until confirmed", async () => {
    await run();
    const page = (await repos.landingPages.bySlug("example-sprint"))!;
    await new Promise((r) => setTimeout(r, 5));
    await repos.landingPages.saveDraft(page.id, { content: [{ type: "Heading", props: { id: "h", text: "My own edit", level: "h1", align: "center" } }], root: {} }, USER);

    const asked = await run();
    expect(asked).toMatchObject({ status: "confirm", existing: { title: "Example Sprint", slug: "example-sprint" } });
    expect(JSON.stringify((await repos.landingPages.bySlug("example-sprint"))!.draft_data)).toContain("My own edit");
    expect(await repos.landingPages.versions(page.id)).toEqual([]);

    const done = await run({ confirm: true });
    expect(done).toMatchObject({ status: "imported", action: "updated", keptBefore: true });
    const kept = (await repos.landingPages.versions(page.id)).find((v) => v.kind === "before_import")!;
    expect(JSON.stringify(await repos.landingPages.versionData(kept.id))).toContain("My own edit");
    // Bringing it back restores the edit into the draft.
    await repos.landingPages.restoreVersion(kept.id);
    expect(JSON.stringify((await repos.landingPages.bySlug("example-sprint"))!.draft_data)).toContain("My own edit");
  });

  it("asks when the draft differs from what is live, and when the title typed is another page's", async () => {
    await run();
    const page = (await repos.landingPages.bySlug("example-sprint"))!;
    await repos.landingPages.publish(page.id);
    const changed = exportSettings();
    (changed.current.sections as Record<string, { blocks: Record<string, { settings: Record<string, unknown> }> }>).main_section.blocks["1600000000200_0"].settings.btn_text = "Changed";
    // Draft and live are the same, so nothing is lost by importing a changed export...
    expect(await run({ zip: exportZip(changed) })).toMatchObject({ status: "imported", action: "updated" });
    // ...but now the draft holds something the live page doesn't, and importing the earlier export would replace it.
    const asked = await run();
    if (asked.status !== "confirm") throw new Error("expected a question");
    expect(asked.reasons[0]).toContain("unpublished changes");

    const titled = await run({ title: "Some Other Page", confirm: false });
    if (titled.status !== "confirm") throw new Error("expected a question");
    expect(titled.reasons.join(" ")).toContain('named "Some Other Page"');
  });
});

describe("replaceReasons and sameDocument", () => {
  it("compares documents whatever order their keys are in", () => {
    expect(sameDocument({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameDocument({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("has no reason for a page nobody edited and a matching title", async () => {
    await run();
    expect(replaceReasons((await repos.landingPages.bySlug("example-sprint"))!, "example sprint")).toEqual([]);
  });
});
