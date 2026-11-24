import { describe, it, expect } from "vitest";
import { mapKajabiPage } from "@/lib/landing/kajabi-import";
import { block, exportSettings } from "@/tests/helpers/kajabi-export";

/** The look of an imported hero: how the picture is framed, the space around the card, a video's still and a white logo. Every fixture is made up. */

const OPTIONS = { siteUrl: "https://kajabi.example.test", cdnBase: "https://cdn.example.test/prefix", year: 2031 };
type Puck = { type: string; props: Record<string, unknown> };
const kids = (b: Puck) => b.props.content as Puck[];

function page(opts: { section?: Record<string, unknown>; header?: Record<string, unknown>; logo?: Record<string, unknown> }) {
  const blocks = { t1: block("text", { width: "7", text_align: "left", background_color: "#eadada", text: "<h1>A big promise</h1><p>Body words here.</p>" }) };
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

describe("the picture's framing and the section's space", () => {
  it("keeps the top of the picture, and fixed, as Kajabi has them; the default is the middle and scrolling", () => {
    const top = page({ section: { bg_position: "top", background_fixed: true } });
    expect(top.content[0].props).toMatchObject({ backgroundPosition: "top", backgroundFixed: true });
    expect(note(top.notes, "approximated", "stays still while the page scrolls")).toBe(true);
    expect(page({}).content[0].props).toMatchObject({ backgroundPosition: "center", backgroundFixed: false });
    expect(page({ section: { bg_position: "bottom" } }).content[0].props.backgroundPosition).toBe("bottom");
  });

  it("takes the space above and below as Kajabi has it: the logo sits near the top and the card starts where Kajabi's does", () => {
    const { content } = page({});
    expect(content[0].props).toMatchObject({ paddingDesktop: { top: 24, bottom: 190 } });
    const [, card] = kids(content[0]);
    expect(card.props).toMatchObject({ paddingDesktop: { top: 190, bottom: 0, left: 0, right: 0 } });
    const plain = page({ header: { position: "static" }, section: { bg_type: "none", bg_image: "", padding_desktop: { top: "30", bottom: "60" }, padding_mobile: { top: "10", bottom: "20" } } });
    expect(plain.content[0].props).toMatchObject({ paddingDesktop: { top: 30, bottom: 60 }, paddingMobile: { top: 10, bottom: 20 } });
  });

  it("puts a card on the left as most of the columns, so it is as wide and as far left as Kajabi's, not the narrow column", () => {
    const [, card] = kids(page({}).content[0]);
    expect(card.props).toMatchObject({ width: "wide", span: 8, spanMobile: 12, textTone: "auto" });
  });

  it("leaves a very faint light tint off, so the picture shows as it is", () => {
    expect(page({ section: { background_color: "rgba(186, 187, 191, 0.15)" } }).content[0].props.overlay).toBe("none");
  });
});

describe("a section's background video", () => {
  it("uses the video's still picture as the background picture and says the video is not imported", () => {
    const video = page({ header: { position: "static" }, section: { bg_type: "video", bg_video: "123", bg_image: "themes/1/settings_images/still.png", background_color: "rgba(186, 187, 191, 0.15)" } });
    expect(video.result.pictures.some((p) => p.url === "https://cdn.example.test/prefix/themes/1/settings_images/still.png")).toBe(true);
    expect(video.content[0].props.backgroundImageAssetId).toBeTruthy();
    expect(note(video.notes, "left_out", "its still picture is the section's background picture")).toBe(true);
  });

  it("says so when the video has no still, and keeps a plain background", () => {
    const none = page({ header: { position: "static" }, section: { bg_type: "video", bg_video: "123", bg_image: "", background_color: "#eadada" } });
    expect(none.content[0].props.backgroundImageAssetId).toBeUndefined();
    expect(note(none.notes, "left_out", "has no still picture")).toBe(true);
  });
});

describe("a picture beside its words", () => {
  function testimonials(second: Record<string, unknown>) {
    const blocks = {
      i1: block("image", { width: "3", image: "assets/face.jpg", image_alt: "A smiling woman" }),
      t1: block("text", { width: "6", text: "<h6>MEMBER SINCE 2021</h6><h4>I was ready to give up</h4><p>Words of thanks.</p>", ...second }),
    };
    const settings = exportSettings({ order: ["s"], sections: { s: { type: "section", settings: { bg_type: "none" }, block_order: Object.keys(blocks), blocks } } });
    const result = mapKajabiPage(settings, OPTIONS);
    if (!result.ok) throw new Error(result.error);
    return result.data.content as Puck[];
  }

  it("is one Split when a narrow picture is followed by a text block that fills the rest of the row", () => {
    const [section] = testimonials({});
    const split = kids(section).find((b) => b.type === "Split")!;
    expect(split.props).toMatchObject({ imageSide: "left", alt: "A smiling woman" });
    expect(String(split.props.html)).toContain("I was ready to give up");
    expect(kids(section).filter((b) => b.type === "Image").length).toBe(kids(testimonials({ width: "10" })[0]).filter((b) => b.type === "Image").length - 1);
    expect(section.props.width).not.toBe("narrow");
  });

  it("stays a picture and a text block when the text is too wide for the rest of the row, or has a fill of its own", () => {
    expect(kids(testimonials({ width: "10" })[0]).map((b) => b.type)).toContain("Image");
    expect(kids(testimonials({ background_color: "#eadada" })[0]).map((b) => b.type)).toContain("Image");
  });
});

describe("a white logo", () => {
  it("gets a plum band of its own when the picture behind it is pale, so it can be seen", () => {
    const { content, notes } = page({ logo: { logo: "assets/Logo_White_Text.png" } });
    expect(content).toHaveLength(2);
    expect(content[0].props).toMatchObject({ background: "plum" });
    expect(kids(content[0])[0].type).toBe("Image");
    expect(kids(content[1])[0].props).toMatchObject({ card: true });
    expect(kids(kids(content[1])[0]).map((b) => b.type)).not.toContain("Image");
    expect(note(notes, "approximated", "white version")).toBe(true);
  });

  it("stays on the picture when the picture is shaded dark", () => {
    const { content } = page({ logo: { logo: "assets/Logo_White_Text.png" }, section: { background_color: "rgba(20, 20, 30, 0.5)" } });
    expect(content).toHaveLength(1);
    expect(kids(content[0])[0].type).toBe("Image");
  });

  it("is also taken off a card on a pale page background", () => {
    const { content } = page({ header: { position: "static" }, section: { bg_type: "none", bg_image: "", background_color: "#ffffff" }, logo: { logo: "assets/Logo_White_Text.png" } });
    expect(content[0].props.background).toBe("plum");
    expect(content).toHaveLength(2);
  });
});
