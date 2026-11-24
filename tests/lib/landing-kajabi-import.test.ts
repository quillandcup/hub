import { describe, it, expect } from "vitest";
import { freeImportKey, keyHasLayout, layoutKeyOf, mapKajabiPage, pageStart, PICTURE_PREFIX, suggestTitle } from "@/lib/landing/kajabi-import";
import { block, exportSettings } from "@/tests/helpers/kajabi-export";

const OPTIONS = { siteUrl: "https://kajabi.example.test", coursesUrl: "https://courses.example.test", cdnBase: "https://cdn.example.test/prefix", year: 2031 };
type Puck = { type: string; props: Record<string, unknown> };
type Sections = Record<string, { type?: string; settings?: Record<string, unknown>; block_order: string[]; blocks: Record<string, { type: string; settings: Record<string, unknown> }> }>;
const sectionsOf = (settings: ReturnType<typeof exportSettings>) => settings.current.sections as unknown as Sections;

function map(settings = exportSettings()) {
  const result = mapKajabiPage(settings, OPTIONS);
  if (!result.ok) throw new Error(result.error);
  const section = result.data.content[0] as Puck;
  return { ...result, section, inner: section.props.content as Puck[], root: (result.data.root as { props: Record<string, unknown> }).props };
}

describe("mapKajabiPage", () => {
  it("turns a section into a Section with its blocks in order, the header's logo first", () => {
    const { inner, section } = map();
    expect(inner.map((b) => b.type)).toEqual(["Image", "Heading", "Divider", "RichText", "Heading", "Button", "Button", "Heading", "RichText", "OptInForm", "Image"]);
    expect(section.props).toMatchObject({ background: "brownMid", width: "medium", align: "center", card: false });
  });

  it("makes headings from h1 to h4, a divider from a rule, and clean rich text from the rest", () => {
    const { inner } = map();
    expect(inner[1]).toMatchObject({ type: "Heading", props: { text: "Write a little, every day", level: "h1", align: "center" } });
    expect(inner[3].props.html).toBe("<p>Join the <strong>Example Sprint</strong> &amp; see.</p><p>Second paragraph.</p>");
    expect(inner[4]).toMatchObject({ type: "Heading", props: { text: "Small heading", level: "h3" } });
    expect(JSON.stringify(inner)).not.toContain("alert");
    expect(JSON.stringify(inner)).not.toContain("EMPTY");
  });

  it("maps buttons: label without markup, colours to the nearest we have, Kajabi paths through the site", () => {
    const { inner, notes } = map();
    expect(inner[5].props).toMatchObject({ label: "Read more here", href: "https://example.com/more", color: "plum", look: "solid", shape: "pill", full: true });
    expect(inner[6].props).toMatchObject({ label: "Dark one", href: "https://kajabi.example.test/resource_redirect/landing_pages/1", color: "brown" });
    expect(notes.some((n) => n.kind === "approximated" && n.text.includes("Dark one") && n.text.includes("/resource_redirect/"))).toBe(true);
  });

  it("does not import hidden blocks and says which, with their links", () => {
    const { inner, notes, counts } = map();
    expect(JSON.stringify(inner)).not.toContain("Old offer");
    expect(notes).toContainEqual({ kind: "hidden", text: 'Hidden in Kajabi, not imported: button "Old offer" (https://example.com/old).' });
    expect(counts.hidden).toBe(1);
  });

  it("makes the sign-up form with the Kajabi form the export names, and says to check it", () => {
    const { inner, notes } = map();
    expect(inner[9].props).toMatchObject({ kajabiFormId: "123456", buttonLabel: "Sign me up", reassurance: "No spam.", instagramField: "none" });
    expect(notes.some((n) => n.kind === "approximated" && n.text.includes("123456") && n.text.includes("check in the editor"))).toBe(true);
    expect(notes.some((n) => n.text.includes("Choose the Kajabi form"))).toBe(false);
    expect(notes.some((n) => n.kind === "todo" && n.text.includes("Instagram"))).toBe(true);
  });

  it("refers to pictures by placeholder, and says where each one is", () => {
    const { inner, pictures, notes } = map();
    expect(inner[0].props.imageAssetId).toBe(`${PICTURE_PREFIX}1`);
    expect(inner[10].props.imageAssetId).toBe(`${PICTURE_PREFIX}2`);
    expect(pictures).toEqual([
      { placeholder: `${PICTURE_PREFIX}1`, url: "https://cdn.example.test/prefix/file-uploads/sites/1/images/banner_abc.png" },
      { placeholder: `${PICTURE_PREFIX}2`, zipName: "photo.png" },
    ]);
    expect(notes.filter((n) => n.kind === "todo" && n.text.includes("description")).length).toBe(2);
  });

  it("uses the copyright line as the footer", () => {
    const { root } = map();
    expect(root).toMatchObject({ showFooter: true, footerText: "© 2031 Example Press LLC" });
  });

  it("makes a key from the layout: the same after the wording changes, different when a block is added, removed or of another kind", () => {
    const key = map().importKey;
    expect(key).toMatch(/^kajabi2:[0-9a-f]{32}$/);
    // Edits to text and settings are the same page.
    const reworded = exportSettings();
    (sectionsOf(reworded).main_section.blocks["1600000000100_0"].settings as Record<string, unknown>).text = "<h1>Another headline</h1><p>Entirely new words.</p>";
    (sectionsOf(reworded).header.blocks["1600000000010_0"].settings as Record<string, unknown>).logo_width = "200";
    expect(map(reworded).importKey).toBe(key);
    // A block removed, added or changed to another kind is another layout.
    const removed = exportSettings();
    delete sectionsOf(removed).main_section.blocks["1600000000400_0"];
    expect(map(removed).importKey).not.toBe(key);
    const added = exportSettings();
    sectionsOf(added).main_section.blocks["1600000000800_0"] = block("text", { text: "<p>New</p>" });
    sectionsOf(added).main_section.block_order.push("1600000000800_0");
    expect(map(added).importKey).not.toBe(key);
    const retyped = exportSettings();
    sectionsOf(retyped).main_section.blocks["1600000000300_0"].type = "image";
    expect(map(retyped).importKey).not.toBe(key);
    const reordered = exportSettings();
    sectionsOf(reordered).main_section.block_order.reverse();
    expect(map(reordered).importKey).not.toBe(key);
  });

  it("does not take two different pages for one when they share a first section and an earliest block", () => {
    // Pages made from the same Kajabi template, or by duplicating a page, share these ids; the rest of the layout differs.
    const page = (extra: string[]) => {
      const settings = exportSettings({ order: ["shared_first_section", ...extra], sections: { shared_first_section: { type: "section", settings: {}, block_order: ["1585757540189"], blocks: { "1585757540189": block("text", { text: "<h1>Same start</h1>" }) } } } });
      for (const id of extra) sectionsOf(settings)[id] = { type: "section", settings: {}, block_order: [`${id}_block`], blocks: { [`${id}_block`]: block("text", { text: "<p>x</p>" }) } };
      return settings;
    };
    const waitlist = map(page(["only_here"]));
    const program = map(page(["something_else", "and_more"]));
    expect(waitlist.importKey).not.toBe(program.importKey);
    expect(waitlist.layout).not.toBe(program.layout);
  });

  it("gives a clone with other words the same key: the layout alone can't tell them apart, so a match is only ever a suggestion", () => {
    const clone = exportSettings();
    (sectionsOf(clone).main_section.blocks["1600000000100_0"].settings as Record<string, unknown>).text = "<h1>A different page</h1>";
    expect(map(clone).importKey).toBe(map().importKey);
  });

  it("tells a stored key's layout apart: its own key and numbered twins, never the first key format", () => {
    const base = layoutKeyOf("abc");
    expect(keyHasLayout(base, "abc")).toBe(true);
    expect(keyHasLayout(`${base}#2`, "abc")).toBe(true);
    expect(keyHasLayout(`${base}#x`, "abc")).toBe(false);
    expect(keyHasLayout(`${base}2`, "abc")).toBe(false);
    expect(keyHasLayout("kajabi:main_section:1600000000100_0", "abc")).toBe(false);
    expect(keyHasLayout(null, "abc")).toBe(false);
    expect(freeImportKey(base, new Set())).toBe(base);
    expect(freeImportKey(base, new Set([base]))).toBe(`${base}#2`);
    expect(freeImportKey(base, new Set([base, `${base}#2`]))).toBe(`${base}#3`);
  });

  it("tells what the export starts with, and suggests a title from it", () => {
    const { start, suggestedTitle } = map();
    expect(start).toEqual({ heading: "Write a little, every day", lines: ["Join the Example Sprint & see.", "Second paragraph.", "Short line."] });
    expect(suggestedTitle).toBe("Write a little, every day");
  });

  it("leaves out blocks and sections it has no counterpart for, and says so", () => {
    const settings = exportSettings({
      order: ["main_section", "extra"],
      sections: {
        extra: { type: "carousel", settings: {}, block_order: ["1600000000900_0"], blocks: { "1600000000900_0": block("social_share", {}) } },
      },
    });
    (settings.current.sections as Record<string, { block_order: string[]; blocks: Record<string, unknown> }>).main_section.blocks["1600000000700_0"] = block("multi_video", {});
    (settings.current.sections as Record<string, { block_order: string[] }>).main_section.block_order.push("1600000000700_0");
    const { notes } = map(settings);
    expect(notes.some((n) => n.kind === "left_out" && n.text.includes("multi_video"))).toBe(true);
    expect(notes.some((n) => n.kind === "left_out" && n.text.includes("carousel"))).toBe(true);
  });

  it("keeps a block hidden on one device only, and says it shows everywhere", () => {
    const settings = exportSettings();
    (settings.current.sections as Record<string, { blocks: Record<string, { settings: Record<string, unknown> }> }>).main_section.blocks["1600000000200_0"].settings.hide_on_mobile = true;
    const { inner, notes } = map(settings);
    expect(inner.some((b) => b.props.label === "Read more here")).toBe(true);
    expect(notes.some((n) => n.kind === "approximated" && n.text.includes("phones only"))).toBe(true);
  });

  it("puts a background picture and a dark shade on a section with an image", () => {
    const settings = exportSettings();
    Object.assign((settings.current.sections as Record<string, { settings: Record<string, unknown> }>).main_section.settings, { bg_type: "image", bg_image: "assets/bg.jpg" });
    const { section, pictures } = map(settings);
    expect(section.props).toMatchObject({ overlay: "dark", backgroundImageAssetId: `${PICTURE_PREFIX}3` });
    expect(pictures.map((p) => p.zipName)).toContain("bg.jpg");
  });

  it("puts a card around a text block that has its own background, not around the whole section", () => {
    const settings = exportSettings();
    (settings.current.sections as Record<string, { blocks: Record<string, { settings: Record<string, unknown> }> }>).main_section.blocks["1600000000100_0"].settings.background_color = "#ffffff";
    const { section, inner } = map(settings);
    expect(section.props.card).toBe(false);
    const card = inner.find((b) => b.type === "Section");
    expect(card?.props).toMatchObject({ card: true, cardColor: "default" });
    expect((card?.props.content as Puck[]).map((b) => b.type)).toContain("Heading");
  });

  it("refuses what is not a page export, and an export with nothing to import", () => {
    expect(mapKajabiPage({}, OPTIONS)).toMatchObject({ ok: false });
    expect(mapKajabiPage(null, OPTIONS)).toMatchObject({ ok: false });
    const allHidden = exportSettings();
    (allHidden.current.sections as Record<string, { settings: Record<string, unknown> }>).main_section.settings = { hide_on_desktop: true, hide_on_mobile: true };
    expect(mapKajabiPage(allHidden, OPTIONS)).toMatchObject({ ok: false, error: expect.stringContaining("Nothing") });
  });

  it("drops links that are not safe", () => {
    const settings = exportSettings();
    (settings.current.sections as Record<string, { blocks: Record<string, { settings: Record<string, unknown> }> }>).main_section.blocks["1600000000200_0"].settings.btn_action = "javascript:alert(1)";
    const { inner, notes } = map(settings);
    expect(inner.find((b) => b.props.label === "Read more here")?.props.href).toBe("");
    expect(notes.some((n) => n.kind === "todo" && n.text.includes("link"))).toBe(true);
  });
});

describe("pageStart and suggestTitle", () => {
  it("finds the first heading and three lines in reading order, inside sections too", () => {
    const data = { content: [{ type: "Section", props: { content: [{ type: "Image", props: {} }, { type: "RichText", props: { html: "<p>One</p><p>Two</p>" } }, { type: "Heading", props: { text: "Later heading" } }, { type: "RichText", props: { html: "<p>Three</p><p>Four</p>" } }] } }], root: {} };
    expect(pageStart(data as never)).toEqual({ heading: "Later heading", lines: ["One", "Two", "Three"] });
    expect(pageStart({ content: [], root: {} })).toEqual({ heading: "", lines: [] });
    expect(pageStart({ content: [{ type: "Heading", props: { text: "x".repeat(300) } }], root: {} } as never).heading).toHaveLength(140);
  });

  it("starts the title from the heading, or the first line; calms capitals; stays within 120 characters", () => {
    expect(suggestTitle({ heading: "JOIN THE EXAMPLE SPRINT", lines: [] })).toBe("Join The Example Sprint");
    expect(suggestTitle({ heading: "", lines: ["First line"] })).toBe("First line");
    expect(suggestTitle({ heading: "Fine as it is", lines: [] })).toBe("Fine as it is");
    expect(suggestTitle({ heading: "", lines: [] })).toBe("");
    expect(suggestTitle({ heading: "12345", lines: [] })).toBe("12345");
    expect(suggestTitle({ heading: "w ".repeat(100), lines: [] }).length).toBeLessThanOrEqual(120);
  });
});
