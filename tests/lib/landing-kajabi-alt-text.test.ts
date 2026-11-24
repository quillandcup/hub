import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { Complete } from "@/lib/landing/ai";
import { applyAltEntries, cleanAlt, parseAltEntries, pictureSlots, promptFor, suggestAltTexts, type PictureSlot } from "@/lib/landing/kajabi-alt-text";
import { mapKajabiPage } from "@/lib/landing/kajabi-import";
import { importKajabiExport, inspectKajabiExport, suggestKajabiAltTexts } from "@/lib/landing/kajabi-import-service";
import { block, exportSettings, exportZip } from "@/tests/helpers/kajabi-export";

/** Fixtures are made up. The default export has a logo, a picture with no description under "Join the list", and a footer line. */

const OPTIONS = { siteUrl: "https://kajabi.example.test", coursesUrl: "https://courses.example.test", cdnBase: "https://cdn.example.test/prefix", year: 2031 };
const mapped = (settings = exportSettings()) => {
  const result = mapKajabiPage(settings, OPTIONS);
  if (!result.ok) throw new Error(result.error);
  return result;
};
const slotsOf = (result: ReturnType<typeof mapped>) => pictureSlots(result.data, { logoBlockId: result.logoBlockId, pictures: result.pictures });

describe("pictureSlots", () => {
  it("lists the logo (named after the footer's brand) and a picture with the headings around it", () => {
    const slots = slotsOf(mapped());
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ role: "logo", headings: ["Example Press LLC"], canBeDecorative: true, fallback: { alt: "Example Press LLC logo", decorative: false } });
    expect(slots[1]).toMatchObject({ role: "picture", headings: ["Join the list", "Write a little, every day"], fallback: { alt: 'Picture for "Join the list"' } });
  });

  it("skips pictures that already have a description, and says a card's picture cannot be decorative", () => {
    const settings = exportSettings({
      order: ["more"],
      sections: {
        more: {
          type: "section",
          settings: {},
          block_order: ["i1", "i2", "c1", "c2"],
          blocks: {
            i1: block("image", { image: "assets/photo.png", image_alt: "A described desk" }),
            i2: block("image", { image: "assets/photo.png", image_alt: "" }),
            c1: block("card", { image: "assets/photo.png", description: "<h3>First card</h3><p>Words.</p>" }),
            c2: block("card", { image: "assets/photo.png", description: "<h3>Second card</h3>" }),
          },
        },
      },
    });
    const slots = slotsOf(mapped(settings));
    expect(slots.filter((s) => s.role !== "logo").map((s) => [s.role, s.canBeDecorative, s.headings[0]])).toEqual([
      ["picture", true, undefined],
      ["card picture", false, "First card"],
      ["card picture", false, "Second card"],
    ]);
  });

  it("falls back to the role when nothing is near, and to a file name that is words (never a camera name)", () => {
    const withFile = (image: string) => slotsOf(mapped(exportSettings({ order: ["more"], sections: { more: { type: "section", settings: {}, block_order: ["i"], blocks: { i: block("image", { image }) } } } }))).find((s) => s.role === "picture")!;
    expect(withFile("assets/writing-desk-at-dawn.png").fallback.alt).toBe("writing desk at dawn");
    expect(withFile("assets/IMG_20311234.png").fallback.alt).toBe("");
    expect(withFile("assets/photo.png").fallback.alt).toBe("");
  });
});

describe("suggestAltTexts", () => {
  const slots = (): PictureSlot[] => slotsOf(mapped());

  it("sends only the role and the headings (never body text, a file name or a picture), and takes the usable answers", async () => {
    const complete = vi.fn<Complete>(async () => ({ descriptions: [{ id: slots()[1].id, alt: "Picture of a notebook beside a mug", decorative: false }, { id: "not-asked", alt: "x" }] }));
    const result = await suggestAltTexts(slots(), mapped().data, complete);

    const [system, prompt, tool] = complete.mock.calls[0];
    expect(tool?.name).toBe("suggest_alt_text");
    expect(system).toContain("NOT shown the pictures");
    // The logo is named from the footer, so only the other picture goes to the model.
    expect(JSON.parse(prompt)).toEqual({ brand: "Example Press LLC", pictures: [{ id: slots()[1].id, role: "picture", mayBeDecorative: true, headings: ["Join the list", "Write a little, every day"] }] });
    for (const text of ["photo.png", "assets", "Second paragraph", "Short line", "No spam"]) expect(prompt).not.toContain(text);
    expect(result.ai).toBe("used");
    expect(result.suggestions).toEqual([
      { id: slots()[0].id, alt: "Example Press LLC logo", decorative: false, by: "fallback" },
      { id: slots()[1].id, alt: "A notebook beside a mug", decorative: false, by: "ai" },
    ]);
  });

  it("makes a picture decorative only when its block may be", async () => {
    const two: PictureSlot[] = [
      { id: "a", role: "picture", headings: ["H"], canBeDecorative: true, fallback: { alt: "x", decorative: false } },
      { id: "b", role: "card picture", headings: ["H"], canBeDecorative: false, fallback: { alt: "y", decorative: false } },
    ];
    const out = await suggestAltTexts(two, mapped().data, async () => ({ descriptions: [{ id: "a", alt: "Swirl", decorative: true }, { id: "b", alt: "Card art", decorative: true }] }));
    expect(out.suggestions.map((s) => [s.id, s.decorative])).toEqual([["a", true], ["b", false]]);
  });

  it("keeps the rules' suggestion for anything the model leaves out or gets wrong", async () => {
    const out = await suggestAltTexts(slots(), mapped().data, async () => ({ descriptions: [{ id: slots()[1].id, alt: "   " }, "junk", null] }));
    expect(out.suggestions[1]).toMatchObject({ alt: 'Picture for "Join the list"', by: "fallback" });
  });

  it("says why the model was not used: not set up, or it failed (and logs no prompt)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await suggestAltTexts(slots(), mapped().data, null)).ai).toBe("not_set_up");
    const failed = await suggestAltTexts(slots(), mapped().data, async () => Promise.reject(new Error("Claude API answered 500")));
    expect(failed.ai).toBe("failed");
    expect(failed.suggestions.every((s) => s.by === "fallback")).toBe(true);
    expect(JSON.stringify(error.mock.calls)).not.toContain("Join the list");
    error.mockRestore();
  });

  it("asks the model nothing when every picture is a logo with a brand name", async () => {
    const complete = vi.fn<Complete>();
    const out = await suggestAltTexts([slots()[0]], mapped().data, complete);
    expect(complete).not.toHaveBeenCalled();
    expect(out.suggestions[0].alt).toBe("Example Press LLC logo");
  });
});

describe("promptFor and cleanAlt", () => {
  it("has nothing but ids, roles, headings and the brand", () => {
    expect(JSON.parse(promptFor([{ id: "x", role: "logo", headings: [], canBeDecorative: true, fallback: { alt: "secret", decorative: false } }], ""))).toEqual({ pictures: [{ id: "x", role: "logo", mayBeDecorative: true, headings: [] }] });
  });
  it("strips a leading 'image of', capitalises, caps the length and refuses an empty answer", () => {
    expect(cleanAlt("an image showing a pen")).toBe("A pen");
    expect(cleanAlt("photo of two mugs")).toBe("Two mugs");
    expect(cleanAlt("x".repeat(300))?.length).toBe(160);
    expect(cleanAlt("  ")).toBeNull();
    expect(cleanAlt(7)).toBeNull();
  });
});

describe("parseAltEntries and applyAltEntries", () => {
  const result = mapped();
  const slots = slotsOf(result);
  const [logo, picture] = slots;

  it("keeps only the ids that were asked for, cleaned, and ignores text that isn't JSON", () => {
    const entries = parseAltEntries(JSON.stringify({ [logo.id]: { alt: "  Brand   logo ", decorative: false }, other: { alt: "x" }, [picture.id]: "junk" }), new Set(slots.map((s) => s.id)));
    expect(entries).toEqual({ [logo.id]: { alt: "Brand logo", decorative: false } });
    expect(parseAltEntries("not json", new Set())).toEqual({});
    expect(parseAltEntries("x".repeat(50_000), new Set())).toEqual({});
    expect(parseAltEntries(JSON.stringify([1]), new Set())).toEqual({});
  });

  it("writes the reviewed text, marks a picture decorative, and counts what is still empty", () => {
    const done = applyAltEntries(result.data, { [logo.id]: { alt: "Brand logo", decorative: false }, [picture.id]: { alt: "", decorative: true } }, slots);
    expect(done.remaining).toBe(0);
    const text = JSON.stringify(done.data);
    expect(text).toContain('"alt":"Brand logo"');
    expect(text).toMatch(/"alt":"","decorative":true/);
    const partial = applyAltEntries(result.data, { [logo.id]: { alt: "Brand logo", decorative: false } }, slots);
    expect(partial.remaining).toBe(1);
  });

  it("does not make a card's picture decorative", () => {
    const card: PictureSlot = { ...picture, id: "GridCard-import-x", canBeDecorative: false };
    const data = { content: [{ type: "GridCard", props: { id: card.id, alt: "", imageAssetId: "kajabi-import-picture:1" } }], root: {} } as never;
    const done = applyAltEntries(data, { [card.id]: { alt: "", decorative: true } }, [card]);
    expect(done.remaining).toBe(1);
    expect(JSON.stringify(done.data)).not.toContain("decorative");
  });
});

// ---- the service ------------------------------------------------------------------------------------------------

describe("the import service and descriptions", () => {
  const storage = { from: () => ({ upload: async () => ({ error: null }) }) } as never;
  const offline = { finalUrl: async () => null, html: async () => null };
  const cdn = async () => ({ error: "offline" });
  const run = async (altTexts?: unknown) => {
    const repos = createInMemoryRepos(new InMemoryDataset());
    const outcome = await importKajabiExport(
      { pages: repos.landingPages, media: repos.media, storage, fetchPicture: cdn, lookupFetchers: offline },
      { archive: exportZip(), title: "Example", target: { kind: "new" }, userId: null, year: 2031, altTexts },
    );
    return { outcome, text: JSON.stringify((await repos.landingPages.bySlug("example"))?.draft_data ?? null) };
  };

  it("inspect lists the pictures that need a description, without calling a model", async () => {
    const repos = createInMemoryRepos(new InMemoryDataset());
    const outcome = await inspectKajabiExport({ pages: repos.landingPages }, { archive: exportZip(), year: 2031 });
    if (outcome.status !== "inspected") throw new Error("expected inspected");
    expect(outcome.pictures.map((p) => p.role)).toEqual(["logo", "picture"]);
  });

  it("suggests with the model it is given, and with rules when it is none", async () => {
    const withModel = await suggestKajabiAltTexts({ archive: exportZip(), year: 2031 }, { complete: async (_s, prompt) => ({ descriptions: [{ id: JSON.parse(prompt).pictures[0].id, alt: "A desk" }] }) });
    expect(withModel).toMatchObject({ status: "suggested", ai: "used" });
    const without = await suggestKajabiAltTexts({ archive: exportZip(), year: 2031 }, { complete: null });
    expect(without).toMatchObject({ status: "suggested", ai: "not_set_up" });
    expect(await suggestKajabiAltTexts({ archive: new Uint8Array([1]), year: 2031 })).toMatchObject({ status: "error" });
  });

  it("writes the reviewed descriptions into the page and drops the generic to-do", async () => {
    const slots = (await suggestKajabiAltTexts({ archive: exportZip(), year: 2031 }, { complete: null }))!;
    if (slots.status !== "suggested") throw new Error("expected suggestions");
    const entries = Object.fromEntries(slots.suggestions.map((s) => [s.id, { alt: `Reviewed ${s.id}`, decorative: false }]));
    const { outcome, text } = await run(JSON.stringify(entries));
    if (outcome.status !== "imported") throw new Error(JSON.stringify(outcome));
    for (const s of slots.suggestions) expect(text).toContain(`Reviewed ${s.id}`);
    expect(outcome.notes.some((n) => /no description/i.test(n.text))).toBe(false);
    expect(outcome.issues.some((i) => /needs a description/.test(i.message))).toBe(false);
  });

  it("says what is still without a description when the admin left some out", async () => {
    const { outcome } = await run(JSON.stringify({}));
    if (outcome.status !== "imported") throw new Error("expected an import");
    expect(outcome.notes).toContainEqual({ kind: "todo", text: expect.stringContaining("2 pictures have no description") });
  });

  it("changes nothing about the descriptions when none are sent (the old behaviour)", async () => {
    const { outcome } = await run();
    if (outcome.status !== "imported") throw new Error("expected an import");
    expect(outcome.notes.some((n) => /A picture has no description/.test(n.text))).toBe(true);
  });
});
