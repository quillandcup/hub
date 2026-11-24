import { describe, it, expect } from "vitest";
import { mapKajabiPage } from "@/lib/landing/kajabi-import";
import { block, exportSettings } from "@/tests/helpers/kajabi-export";

/** How an imported page looks like its original: the overlay, the card, where it sits, the logo, the text colour. Every fixture is made up. */

const OPTIONS = { siteUrl: "https://kajabi.example.test", cdnBase: "https://cdn.example.test/prefix", year: 2031 };
type Puck = { type: string; props: Record<string, unknown> };
const kids = (b: Puck) => b.props.content as Puck[];
const PLUM = '<span style="color: #a64d79;">';

function page(opts: { section?: Record<string, unknown>; blocks?: Record<string, ReturnType<typeof block>>; header?: Record<string, unknown>; logo?: Record<string, unknown> }) {
  const blocks = opts.blocks ?? { t1: block("text", { width: "7", text_align: "left", background_color: "#eadada", text: `<h5>${PLUM}Intro line</span></h5><h1>${PLUM}A big promise</span></h1><p>${PLUM}Body words here.</span></p>` }) };
  const settings = exportSettings({
    order: ["hero"],
    sections: {
      hero: { type: "section", settings: { bg_type: "image", bg_image: "assets/bg.jpg", background_color: "rgba(244, 236, 232, 0.45)", horizontal: "left", full_width: true, padding_desktop: { top: "190", bottom: "190" }, ...opts.section }, block_order: Object.keys(blocks), blocks },
      header: { type: "header", settings: { position: "overlay", ...opts.header }, block_order: ["lg"], blocks: { lg: block("logo", { logo: "assets/logo.png", image_alt: "A logo", logo_width: "300", alignment: "center", logo_type: "image", ...opts.logo }) } },
    },
  });
  const result = mapKajabiPage(settings, OPTIONS);
  if (!result.ok) throw new Error(result.error);
  return { result, content: result.data.content as Puck[], notes: result.notes };
}
const note = (notes: { kind: string; text: string }[], kind: string, text: string) => notes.some((n) => n.kind === kind && n.text.includes(text));

describe("the shade over a section's picture", () => {
  it("is a soft light shade when Kajabi tints the picture with a light colour at low strength", () => {
    const { content, notes } = page({});
    expect(content[0].props.overlay).toBe("cream");
    expect(note(notes, "approximated", "light tint in Kajabi (rgba(244, 236, 232, 0.45))")).toBe(true);
  });

  it("is the stronger light shade for a light tint at high strength, and dark for a dark tint or none", () => {
    expect(page({ section: { background_color: "rgba(255, 255, 255, 0.9)" } }).content[0].props.overlay).toBe("light");
    expect(page({ section: { background_color: "rgba(20, 20, 30, 0.5)" } }).content[0].props.overlay).toBe("dark");
    const none = page({ section: { background_color: "" } });
    expect(none.content[0].props.overlay).toBe("dark");
    expect(note(none.notes, "approximated", "dark shade was added")).toBe(true);
  });

  it("does not make the tint the section's background colour", () => {
    expect(page({}).notes.some((n) => n.text.includes("Section background"))).toBe(false);
  });
});

describe("the logo over the picture", () => {
  it("stays out of the card: the picture is a band with the logo on it and the card is a Section of its own", () => {
    const { content } = page({});
    expect(content).toHaveLength(1);
    const [logo, card] = kids(content[0]);
    expect(logo).toMatchObject({ type: "Image", props: { size: "small", align: "center" } });
    expect(card.type).toBe("Section");
    expect(kids(card).map((b) => b.type)).not.toContain("Image");
    expect(content[0].props).toMatchObject({ width: "wide", card: false });
    expect(card.props).toMatchObject({ overlay: "none", background: "none", card: true });
  });

  it("is sized by the logo's width in Kajabi, and follows its alignment when the card is not centred", () => {
    expect(kids(page({ logo: { logo_width: "300" } }).content[0])[0].props.size).toBe("small");
    expect(kids(page({ logo: { logo_width: "400" } }).content[0])[0].props.size).toBe("medium");
    expect(kids(page({ logo: { logo_width: "650" } }).content[0])[0].props.size).toBe("full");
    expect(kids(page({ logo: { alignment: "right" }, section: { horizontal: "left" } }).content[0])[0].props.align).toBe("right");
  });

  it("is the first thing in the first section when the header is not over a picture", () => {
    const flat = page({ header: { position: "static" } });
    const [flatCard] = kids(flat.content[0]);
    expect(kids(flatCard)[0].type).toBe("Image");
    expect(flatCard.props.card).toBe(true);
    const noPicture = page({ section: { bg_type: "none", bg_image: "" } });
    expect(kids(kids(noPicture.content[0])[0])[0].type).toBe("Image");
  });
});

describe("the card", () => {
  it("takes the block's fill as the nearest theme colour, its width and its side, and keeps plum text", () => {
    const [, card] = kids(page({}).content[0]);
    expect(card.props).toMatchObject({ cardColor: "blush", cardSoft: false, place: "center", width: "wide", span: 8, spanMobile: 12, align: "left", textTone: "plum" });
  });

  it("is a theme colour at 80% when the fill has some transparency, white and plain when the fill is white", () => {
    const soft = page({ blocks: { t1: block("text", { width: "7", text_align: "left", background_color: "rgba(193, 157, 133, 0.48)", text: "<p>Words</p>" }) } });
    expect(kids(soft.content[0])[1].props.cardSoft).toBe(true);
    expect(note(soft.notes, "approximated", "a little see-through")).toBe(true);
    const white = page({ blocks: { t1: block("text", { width: "7", background_color: "#ffffff", text: "<p>Words</p>" }) } });
    expect(kids(white.content[0])[1].props).toMatchObject({ cardColor: "default", cardSoft: false });
  });

  it("sits on the right when Kajabi puts the section on the right, and in the middle otherwise", () => {
    expect(kids(page({ section: { horizontal: "right" } }).content[0])[1].props.place).toBe("right");
    expect(kids(page({ section: { horizontal: "center" } }).content[0])[1].props.place).toBe("center");
  });

  it("is not full width because Kajabi's section is: a block of seven twelfths on the left is a card of most of the columns, not the whole row", () => {
    expect(kids(page({ section: { full_width: true } }).content[0])[1].props).toMatchObject({ width: "wide", span: 8 });
    expect(kids(page({ section: { full_width: true, horizontal: "right" } }).content[0])[1].props.width).toBe("narrow");
  });

  it("is a card around only the block that has a fill, when other blocks in the section have none", () => {
    const mixed = page({
      header: { position: "static" },
      section: { bg_type: "none", bg_image: "", background_color: "" },
      blocks: { t1: block("text", { width: "8", background_color: "#c7dfdf", text: "<h2>Boxed</h2><p>In a card.</p>" }), t2: block("text", { width: "8", text: "<h2>Plain</h2><p>Not in a card.</p>" }) },
    });
    const inner = kids(mixed.content[0]);
    expect(mixed.content[0].props.card).toBe(false);
    expect(inner.map((b) => b.type)).toEqual(["Image", "Section", "Heading", "RichText"]);
    expect(inner[1].props).toMatchObject({ card: true, cardColor: "mist", width: "medium" });
    expect(kids(inner[1]).map((b) => b.type)).toEqual(["Heading", "RichText"]);
  });

  it("is the section's own card when every block has a fill", () => {
    const all = page({ header: { position: "static" }, section: { bg_type: "none", bg_image: "", background_color: "" }, blocks: { t1: block("text", { width: "7", background_color: "#4d4d4d", text: "<h1>One</h1>" }) } });
    expect(kids(all.content[0])[0].props).toMatchObject({ card: true, cardColor: "charcoal", width: "wide", span: 8 });
  });
});

describe("text colour and headings", () => {
  it("keeps plum where most of the words are plum, and the theme's colour otherwise", () => {
    const grey = page({ blocks: { t1: block("text", { width: "7", background_color: "#ffffff", text: `<p>Plain words that are the page's own colour.</p><p>${PLUM}Short.</span></p>` }) } });
    expect(kids(grey.content[0])[1].props.textTone).toBe("auto");
  });

  it("says which other colours were not kept, and ignores greys", () => {
    const green = page({ blocks: { t1: block("text", { width: "7", background_color: "#ffffff", text: '<p><span style="color: #127059;">Green words</span></p><p><span style="color: #4d4d4d;">Grey words</span></p>' }) } });
    expect(note(green.notes, "approximated", "Coloured text (#127059)")).toBe(true);
    expect(green.notes.some((n) => n.text.includes("#4d4d4d"))).toBe(false);
  });

  it("makes an h5 or h6 a heading (the smallest we have), not plain text", () => {
    const { content } = page({ blocks: { t1: block("text", { width: "7", background_color: "#eadada", text: "<h5>Intro</h5><h6>Smaller</h6>" }) } });
    expect(kids(kids(content[0])[1]).map((b) => [b.type, b.props.text, b.props.level])).toEqual([["Heading", "Intro", "h3"], ["Heading", "Smaller", "h3"]]);
  });
});

describe("a plain text section keeps its old look", () => {
  it("has no card, no place and the theme's text", () => {
    const { content } = page({ header: { position: "static" }, section: { bg_type: "none", bg_image: "", background_color: "#ffffff", horizontal: "center", full_width: false }, blocks: { t1: block("text", { width: "12", text: "<p>Just words.</p>" }) } });
    expect(content[0].props).toMatchObject({ card: false, cardColor: "default", cardSoft: false, place: "center", textTone: "auto", overlay: "none", width: "wide" });
  });
});
