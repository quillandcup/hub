import { describe, it, expect } from "vitest";
import { mapKajabiPage, PICTURE_PREFIX } from "@/lib/landing/kajabi-import";
import { block, exportSettings } from "@/tests/helpers/kajabi-export";

const OPTIONS = { siteUrl: "https://kajabi.example.test", cdnBase: "https://cdn.example.test/prefix", year: 2031 };
type Puck = { type: string; props: Record<string, unknown> };

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

  it("makes the sign-up form without a form chosen, and tells how to pick it", () => {
    const { inner, notes } = map();
    expect(inner[9].props).toMatchObject({ kajabiFormId: "", buttonLabel: "Sign me up", reassurance: "No spam.", instagramField: "none" });
    expect(notes.some((n) => n.kind === "todo" && n.text.includes("123456"))).toBe(true);
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

  it("is identified by the main section and its earliest block, whatever else changes", () => {
    expect(map().importKey).toBe("kajabi:main_section:1600000000100_0");
    const changed = exportSettings();
    delete (changed.current.sections as Record<string, { blocks?: Record<string, unknown> }>).main_section.blocks!["1600000000400_0"];
    expect(map(changed).importKey).toBe("kajabi:main_section:1600000000100_0");
  });

  it("leaves out blocks and sections it has no counterpart for, and says so", () => {
    const settings = exportSettings({
      order: ["main_section", "extra"],
      sections: {
        extra: { type: "carousel", settings: {}, block_order: ["1600000000900_0"], blocks: { "1600000000900_0": block("card", {}) } },
      },
    });
    (settings.current.sections as Record<string, { block_order: string[]; blocks: Record<string, unknown> }>).main_section.blocks["1600000000700_0"] = block("countdown", {});
    (settings.current.sections as Record<string, { block_order: string[] }>).main_section.block_order.push("1600000000700_0");
    const { notes } = map(settings);
    expect(notes.some((n) => n.kind === "left_out" && n.text.includes("countdown"))).toBe(true);
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

  it("boxes a section whose text block has its own background", () => {
    const settings = exportSettings();
    (settings.current.sections as Record<string, { blocks: Record<string, { settings: Record<string, unknown> }> }>).main_section.blocks["1600000000100_0"].settings.background_color = "#ffffff";
    expect(map(settings).section.props.card).toBe(true);
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
