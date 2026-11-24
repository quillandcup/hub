import { describe, it, expect } from "vitest";
import { mapKajabiPage, PICTURE_PREFIX } from "@/lib/landing/kajabi-import";
import { block, exportSettings } from "@/tests/helpers/kajabi-export";

/** The block types the importer maps beyond text, pictures, buttons and forms. Every fixture is made up. */

const OPTIONS = { siteUrl: "https://kajabi.example.test", cdnBase: "https://cdn.example.test/prefix", year: 2031 };
type Puck = { type: string; props: Record<string, unknown> };
type Made = ReturnType<typeof block>;

/** A page of the default section plus one more section holding these blocks, in order. Returns that section's blocks. */
function more(blocks: Record<string, Made>, extra: { sections?: Record<string, unknown>; order?: string[] } = {}) {
  const settings = exportSettings({
    order: ["main_section", "more", ...(extra.order ?? [])],
    sections: { more: { type: "section", settings: {}, block_order: Object.keys(blocks), blocks }, ...extra.sections },
  });
  const result = mapKajabiPage(settings, OPTIONS);
  if (!result.ok) throw new Error(result.error);
  const section = result.data.content[1] as Puck | undefined;
  return { result, section, inner: (section?.props.content ?? []) as Puck[], notes: result.notes, json: JSON.stringify(result.data) };
}
const kids = (block: Puck) => block.props.items as Puck[];
const note = (notes: { kind: string; text: string }[], kind: string, text: string) => notes.some((n) => n.kind === kind && n.text.includes(text));

describe("feature", () => {
  const feature = (over: Record<string, unknown> = {}) => block("feature", { width: "12", image: "assets/photo.png", image_alt: "A desk", text: "<h4>Why it works</h4><p>Short <strong>reason</strong>.</p><script>alert(1)</script><p>&nbsp;</p>", use_btn: false, ...over });

  it("becomes a picture beside its words, cleaned", () => {
    const { inner, result } = more({ f1: feature() });
    expect(inner).toHaveLength(1);
    expect(inner[0]).toMatchObject({ type: "Split", props: { imageAssetId: expect.stringContaining(PICTURE_PREFIX), alt: "A desk", imageSide: "left", decorative: false } });
    expect(inner[0].props.html).toBe("<h4>Why it works</h4><p>Short <strong>reason</strong>.</p>");
    expect(result.pictures.filter((p) => p.zipName === "photo.png")).toHaveLength(1); // the same file as the main section's picture: one placeholder
  });

  it("asks for a description when the picture has none", () => {
    expect(note(more({ f1: feature({ image_alt: "" }) }).notes, "todo", "no description")).toBe(true);
  });

  it("keeps its button, and is only words when its picture is hidden", () => {
    const { inner } = more({ f1: feature({ hide_image: true, use_btn: true, btn_text: "Read it", btn_action: "https://example.com/read" }) });
    expect(inner.map((b) => b.type)).toEqual(["Heading", "RichText", "Button"]);
    expect(inner[2].props).toMatchObject({ label: "Read it", href: "https://example.com/read" });
  });

  it("says when it has nothing to show, and a hidden one stays hidden", () => {
    const empty = more({ f1: feature({ image: "", text: "" }), f2: block("text", { text: "<p>Kept</p>" }) });
    expect(note(empty.notes, "left_out", "has no text or picture")).toBe(true);
    const hidden = more({ f1: block("feature", { image: "assets/photo.png", text: "<p>Hidden one</p>" }, { hidden: "true" }), f2: block("text", { text: "<p>Kept</p>" }) });
    expect(hidden.json).not.toContain("Hidden one");
    expect(note(hidden.notes, "hidden", "feature (feature)")).toBe(true);
  });
});

describe("card", () => {
  const card = (title: string, over: Record<string, unknown> = {}) => block("card", { width: "4", image: "assets/photo.png", description: `<h4>${title}</h4><p>&nbsp;</p><ul><li>First <strong>point</strong></li><li>Second point</li></ul><p>A closing line.</p>`, show_cta: false, action: "", background_color: "#c7dfdf", ...over });

  it("turns cards in a row into one Card grid, with the first heading as the title and the rest as plain lines", () => {
    const { inner, notes, section } = more({ c1: card("One"), c2: card("Two"), c3: card("Three", { show_cta: true, btn_text: "Go<br>now", action: "https://example.com/three" }) });
    expect(inner).toHaveLength(1);
    expect(inner[0]).toMatchObject({ type: "CardGrid", props: { columns: "3" } });
    const [one, , three] = kids(inner[0]);
    expect(one).toMatchObject({ type: "GridCard", props: { title: "One", description: "• First point\n• Second point\nA closing line.", price: "", buttonLabel: "", href: "" } });
    expect(one.props.imageAssetId).toEqual(expect.stringContaining(PICTURE_PREFIX));
    expect(three.props).toMatchObject({ title: "Three", buttonLabel: "Go now", href: "https://example.com/three" });
    expect(note(notes, "approximated", "3 cards became a Card grid")).toBe(true);
    expect(note(notes, "approximated", "plain lines")).toBe(true);
    expect(note(notes, "todo", "no description")).toBe(true);
    // A card's share of a row doesn't make the section narrow.
    expect(section?.props.width).toBe("wide");
  });

  it("keeps a hidden card out, and starts a new grid after another kind of block", () => {
    const { inner } = more({ c1: card("One"), c2: block("card", { description: "<h4>Hidden</h4>" }, { hidden: "true" }), c3: card("Two"), t: block("text", { text: "<p>Between</p>" }), c4: card("Three") });
    expect(inner.map((b) => b.type)).toEqual(["CardGrid", "RichText", "CardGrid"]);
    expect(kids(inner[0]).map((c) => c.props.title)).toEqual(["One", "Two"]);
    expect(inner[0].props.columns).toBe("2");
    expect(kids(inner[2]).map((c) => c.props.title)).toEqual(["Three"]);
  });

  it("uses the first line as the title when the card has no heading, and no picture when it has none", () => {
    const { inner } = more({ c1: card("x", { description: "<p>Just words</p><p>More words</p>", image: "" }) });
    expect(kids(inner[0])[0].props).toMatchObject({ title: "Just words", description: "More words", imageAssetId: undefined });
  });

  it("never lets markup or a script through, and drops an unsafe link", () => {
    const { inner, notes, json } = more({ c1: card("Safe", { description: '<h4>Safe</h4><p onclick="x()">Words<img src=x onerror="alert(1)"><script>alert(2)</script></p>', action: "javascript:alert(3)", show_cta: true, btn_text: "Go" }) });
    expect(kids(inner[0])[0].props).toMatchObject({ title: "Safe", description: "Words", href: "" });
    expect(json).not.toMatch(/onerror|onclick|<script|javascript:/i);
    expect(note(notes, "todo", 'Card "Safe"')).toBe(true);
  });

  it("asks for a button label when the whole card links somewhere", () => {
    const { notes, inner } = more({ c1: card("Linked", { action: "https://example.com/x" }) });
    expect(kids(inner[0])[0].props.href).toBe("https://example.com/x");
    expect(note(notes, "todo", "add a button label")).toBe(true);
  });
});

describe("pricing", () => {
  const plan = (name: string, over: Record<string, unknown> = {}) =>
    block("pricing", { width: "5", name, price: "$97", heading: "Pay once.", text: '<p><strong>What you get</strong></p><ul><li>One thing</li></ul>', show_cta: true, btn_text: "Enroll", btn_action: "/resource_redirect/offers/AAA", show_secondary_cta: true, secondary_btn_text: "Payment plan", secondary_btn_action: "https://example.com/plan", secondary_btn_style: "outline", ...over });

  it("carries the name, the price as written, the list and the checkout link into a Pricing block, and puts a second button after it", () => {
    const { inner, notes } = more({ p1: plan("Plan A"), p2: plan("Plan B", { price: "$197", btn_action: "https://example.com/b", show_secondary_cta: false }) });
    expect(inner.map((b) => b.type)).toEqual(["Pricing", "Button"]);
    const [a, b] = kids(inner[0]);
    expect(kids(inner[0]).map((k) => k.type)).toEqual(["PricingPlan", "PricingPlan"]);
    expect(a.props).toMatchObject({ name: "Plan A", price: "$97", period: "", description: "Pay once.\nWhat you get", features: "One thing", badge: "", featured: false, buttonLabel: "Enroll", href: "https://kajabi.example.test/resource_redirect/offers/AAA" });
    expect(b.props).toMatchObject({ name: "Plan B", price: "$197", href: "https://example.com/b" });
    expect(inner[1].props).toMatchObject({ label: "Payment plan", href: "https://example.com/plan", look: "outline" });
    expect(note(notes, "approximated", "2 pricing columns became a Pricing block")).toBe(true);
    expect(note(notes, "approximated", "billing period line is empty")).toBe(true);
    expect(note(notes, "approximated", "1 second button follow")).toBe(true);
    expect(note(notes, "approximated", "/resource_redirect/offers/AAA")).toBe(true);
  });

  it("splits a row of more than three plans into Pricing blocks of at most three", () => {
    const { inner, notes } = more({ p1: plan("A", { show_secondary_cta: false }), p2: plan("B", { show_secondary_cta: false }), p3: plan("C", { show_secondary_cta: false }), p4: plan("D", { show_secondary_cta: false }) });
    expect(inner.map((b) => kids(b).length)).toEqual([3, 1]);
    expect(note(notes, "approximated", "4 pricing columns became 2 Pricing blocks")).toBe(true);
  });

  it("invents nothing: a plan with no price, words or link has none, and says so", () => {
    const { inner, notes } = more({ p1: plan("Bare", { price: "", heading: "", btn_action: "", show_secondary_cta: false, text: "" }) });
    expect(kids(inner[0])[0].props).toMatchObject({ name: "Bare", price: "", period: "", description: "", features: "", href: "" });
    expect(note(notes, "todo", "has no link")).toBe(true);
  });

  it("leaves out a plan hidden in Kajabi, a button that is turned off, and a picture the block has no room for, and never lets markup through", () => {
    const { inner, notes, json } = more({ p1: plan("Shown", { show_cta: false, show_image: true, image: "assets/p.png", text: '<ul><li>Safe <a href="javascript:alert(1)">x</a><script>alert(2)</script></li></ul>' }), p2: block("pricing", { name: "Hidden", price: "$1" }, { hidden: "true" }) });
    expect(kids(inner[0])).toHaveLength(1);
    expect(kids(inner[0])[0].props).toMatchObject({ buttonLabel: "", features: "Safe x" });
    expect(note(notes, "left_out", "1 pricing column picture not imported")).toBe(true);
    expect(json).not.toMatch(/<script|javascript:|alert/i);
  });
});

describe("offer", () => {
  it("is reported and not invented: the export has only the offer's id", () => {
    const { inner, notes } = more({ o1: block("offer", { offer: "OFFER1", show_cta: true, btn_text: "Buy it" }), t: block("text", { text: "<p>Kept</p>" }) });
    expect(inner.map((b) => b.type)).toEqual(["RichText"]);
    expect(note(notes, "todo", "OFFER1")).toBe(true);
    expect(note(notes, "todo", 'its button says "Buy it"')).toBe(true);
  });
});

describe("accordion", () => {
  const item = (heading: string, body: string, over: Record<string, unknown> = {}) => block("accordion", { width: "8", heading, body, ...over });

  it("turns items in a row into one Accordion (Kajabi's accordion is a generic list, not questions)", () => {
    const { inner, notes } = more({ a1: item("Is it for me?", "<p>Yes.</p><ul><li>Because one</li><li>Because two</li></ul>"), a2: item("How long?", "<p>Ten months.</p>"), a3: block("accordion", { heading: "Hidden?", body: "<p>x</p>" }, { hidden: "true" }) });
    expect(inner).toHaveLength(1);
    expect(inner[0].type).toBe("Accordion");
    expect(kids(inner[0]).map((k) => k.props)).toEqual([
      expect.objectContaining({ title: "Is it for me?", text: "Yes.\n• Because one\n• Because two", open: false }),
      expect.objectContaining({ title: "How long?", text: "Ten months." }),
    ]);
    expect(note(notes, "approximated", "text under each accordion item is plain lines")).toBe(true);
  });

  it("leaves an item with no heading out, and never lets markup or a script through", () => {
    const { inner, notes, json } = more({ a1: item("", "<p>Orphan</p>"), a2: item("Safe?", '<p>Words <a href="javascript:alert(1)">link</a></p><script>alert(2)</script><iframe src="https://evil.example"></iframe>') });
    expect(kids(inner[0])).toHaveLength(1);
    expect(kids(inner[0])[0].props.text).toBe("Words link");
    expect(json).not.toMatch(/<script|<iframe|javascript:|alert/i);
    expect(note(notes, "left_out", "no heading")).toBe(true);
  });
});

describe("countdown", () => {
  it("is a Countdown with no date, and says the date must be set", () => {
    const { inner, notes } = more({ c1: block("countdown", { event: "EVENT1", width: "6" }) });
    expect(inner[0]).toMatchObject({ type: "Countdown", props: { targetAt: "", heading: "", whenExpired: "zeros" } });
    expect(note(notes, "todo", "EVENT1")).toBe(true);
    expect(note(notes, "todo", "Set the date")).toBe(true);
  });

  it("hides itself at the end when Kajabi removed its section, and says an end action is not imported", () => {
    const { inner, notes } = more({ c1: block("countdown", { event: "E", remove_section_on_complete: true, enable_end_action: true, end_action: "redirect" }) });
    expect(inner[0].props.whenExpired).toBe("hide");
    expect(note(notes, "left_out", "(redirect) is not imported")).toBe(true);
  });
});

describe("video", () => {
  it("is an empty Video block with the Kajabi id in the to-do, never a made-up address", () => {
    const { inner, notes, json } = more({ v1: block("video", { video: "VIDEO1", image: "assets/photo.png" }) });
    expect(inner[0]).toMatchObject({ type: "Video", props: { url: "", title: "" } });
    expect(note(notes, "todo", "Kajabi video VIDEO1")).toBe(true);
    expect(json).not.toContain("VIDEO1");
  });
});

describe("link_list", () => {
  it("in a section is an empty Link list, because the export names the menu and not its links", () => {
    const { inner, notes } = more({ l1: block("link_list", { menu: "MENU1" }) });
    expect(inner[0]).toMatchObject({ type: "LinkList", props: { items: [] } });
    expect(note(notes, "todo", "MENU1")).toBe(true);
  });

  it("in the footer is left out, and says why", () => {
    const settings = exportSettings();
    (settings.current.sections as Record<string, { block_order: string[]; blocks: Record<string, unknown> }>).footer.blocks["1600000000030_0"] = block("link_list", { menu: "MENU1" }, { name: "Link List" });
    (settings.current.sections as Record<string, { block_order: string[] }>).footer.block_order.push("1600000000030_0");
    const result = mapKajabiPage(settings, OPTIONS);
    if (!result.ok) throw new Error(result.error);
    expect(note(result.notes, "left_out", "not its links")).toBe(true);
  });
});

describe("social_icons", () => {
  it("becomes a Social icons block with the networks that have an address, in order, with its alignment", () => {
    const { inner, notes } = more({ s1: block("social_icons", { horizontal: "right", social_icon_link_instagram: "https://instagram.example.com/me", social_icon_link_twitter: "https://x.example.com/me", social_icon_link_youtube: "https://youtube.example.com/me", social_icon_link_facebook: "" }) });
    expect(inner[0]).toMatchObject({ type: "SocialIcons", props: { align: "right", size: "medium" } });
    expect(kids(inner[0]).map((k) => [k.type, k.props.network, k.props.url])).toEqual([
      ["SocialLink", "instagram", "https://instagram.example.com/me"],
      ["SocialLink", "x", "https://x.example.com/me"],
      ["SocialLink", "youtube", "https://youtube.example.com/me"],
    ]);
    expect(note(notes, "approximated", "Social icons became a Social icons block (Instagram, Twitter, YouTube)")).toBe(true);
  });

  it("names the networks the block has no mark for and leaves them out, and asks for a link that can't be used", () => {
    const { inner, notes } = more({ s1: block("social_icons", { social_icon_link_instagram: "https://a.example.com", social_icon_link_linkedin: "javascript:alert(1)", social_icon_link_spotify: "https://e.example.com", social_icon_link_apple_podcasts: "https://f.example.com", social_icon_size: "large" }) });
    expect(kids(inner[0]).map((k) => k.props.network)).toEqual(["instagram", "linkedin"]);
    expect(kids(inner[0])[1].props.url).toBe("");
    expect(inner[0].props.size).toBe("large");
    expect(note(notes, "left_out", "Spotify, Apple Podcasts are not imported")).toBe(true);
    expect(note(notes, "todo", "LinkedIn link")).toBe(true);
  });

  it("is left out with no links or only networks the block does not have, and a hidden one stays hidden", () => {
    const empty = more({ s1: block("social_icons", {}), t: block("text", { text: "<p>Kept</p>" }) });
    expect(note(empty.notes, "left_out", "no links to import")).toBe(true);
    const only = more({ s1: block("social_icons", { social_icon_link_spotify: "https://e.example.com" }), t: block("text", { text: "<p>Kept</p>" }) });
    expect(only.inner.map((b) => b.type)).toEqual(["RichText"]);
    expect(note(only.notes, "left_out", "Spotify")).toBe(true);
    const hidden = more({ s1: block("social_icons", { social_icon_link_instagram: "https://a.example.com" }, { hidden: "true" }), t: block("text", { text: "<p>Kept</p>" }) });
    expect(hidden.json).not.toContain("a.example.com");
  });
});

describe("code", () => {
  const SCRIPT = "<div id='product-1'></div><script>var s = document.createElement('script'); s.src = 'https://sdk.example.com/buy.js';</script>";

  it("leaves out anything that runs or loads another site, and says so once with how many and from where", () => {
    const { inner, notes, json } = more({
      c1: block("code", { code: SCRIPT }),
      c2: block("code", { code: '<iframe src="https://widgets.example.com/x"></iframe>' }),
      c3: block("code", { code: '<p onclick="steal()">Click</p>' }),
      c4: block("code", { code: '<a href="javascript:steal()">x</a>' }),
      c5: block("code", { code: "<style>body{display:none}</style>" }),
      t: block("text", { text: "<p>Kept</p>" }),
    });
    expect(inner.map((b) => b.type)).toEqual(["RichText"]);
    const said = notes.filter((n) => n.text.includes("embedded code block"));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ kind: "left_out" });
    expect(said[0].text).toContain("5 embedded code blocks run a script or load another site");
    expect(said[0].text).toContain("sdk.example.com");
    expect(json).not.toMatch(/<script|<iframe|<style|onclick|javascript:|steal/i);
  });

  it("keeps plain HTML as text, through the rich text rules, and says so", () => {
    const { inner, notes, json } = more({ c1: block("code", { code: '<h2>Books</h2><p>A <b>plain</b> note with a <a href="https://example.com/b">link</a>.</p>', text_align: "center" }) });
    expect(inner.map((b) => b.type)).toEqual(["Heading", "RichText"]);
    expect(inner[0].props.text).toBe("Books");
    expect(String(inner[1].props.html)).toContain('<a href="https://example.com/b"');
    expect(json).not.toContain("<script");
    expect(note(notes, "approximated", "was plain HTML")).toBe(true);
  });

  it("says when there is nothing in it, and drops a section with nothing left", () => {
    const empty = more({ c1: block("code", { code: "" }) });
    expect(note(empty.notes, "left_out", "has nothing to show")).toBe(true);
    expect(empty.section).toBeUndefined();
    expect(note(empty.notes, "left_out", "had nothing that could be imported")).toBe(true);
  });
});

describe("blog", () => {
  it("is left out, because the blog stays on Kajabi", () => {
    const { inner, notes } = more({ b1: block("blog", { post: "1" }, { name: "Latest post" }), t: block("text", { text: "<p>Kept</p>" }) });
    expect(inner.map((b) => b.type)).toEqual(["RichText"]);
    expect(note(notes, "left_out", "blog stays on Kajabi")).toBe(true);
  });
});

describe("the whole result stays safe", () => {
  it("passes every block's text through the sanitizer, whatever the export holds", () => {
    const { json } = more({
      f: block("feature", { image: "assets/photo.png", text: '<p>x</p><img src=x onerror="alert(1)"><script>alert(2)</script>' }),
      c: block("card", { description: '<h4>t</h4><p>d</p><script>alert(3)</script>', action: "https://example.com", show_cta: true, btn_text: "Go" }),
      a: block("accordion", { heading: "q", body: "<script>alert(4)</script><p>a</p>" }),
      k: block("code", { code: "<p>fine</p><script>alert(5)</script>" }),
    });
    expect(json).not.toMatch(/alert\(|<script|onerror/);
  });
});

describe("buttons inside a text block", () => {
  const withButton = (label: string, action: string, over: Record<string, unknown> = {}) => ({ use_btn: true, btn_text: label, btn_action: action, btn_background_color: "#a64d79", btn_width: "full", ...over });
  const text = (html: string, over: Record<string, unknown> = {}) => block("text", { width: "7", text_align: "left", text: html, ...over });

  it("follows its text as a Button block, with the look of a call to action", () => {
    const { inner, notes } = more({ t1: text("<h2>Join us</h2><p>Words here.</p>", withButton("Join now", "https://example.com/join")) });
    expect(inner.map((b) => b.type)).toEqual(["Heading", "RichText", "Button"]);
    expect(inner[2].props).toMatchObject({ label: "Join now", href: "https://example.com/join", look: "solid", color: "plum", full: true });
    expect(note(notes, "approximated", "1 button inside text blocks is now a Button block right after its text")).toBe(true);
    expect(notes.some((n) => n.text.includes("has a button inside it"))).toBe(false);
  });

  it("takes two buttons in two text blocks, and none from a block with its button switched off", () => {
    const { inner, notes } = more({
      t1: text("<p>One</p>", withButton("First", "https://example.com/1")),
      t2: text("<p>Two</p>", { use_btn: false, btn_text: "Call To Action", btn_action: "https://example.com/unused" }),
      t3: text("<p>Three</p>", withButton("Second<br>one", "https://example.com/3", { btn_style: "outline", btn_text_color: "#a64d79", btn_background_color: "", text_align: "center" })),
    });
    expect(inner.map((b) => b.type)).toEqual(["RichText", "Button", "RichText", "RichText", "Button"]);
    expect(inner[1].props.label).toBe("First");
    expect(inner[4].props).toMatchObject({ label: "Second one", look: "outline", align: "center" });
    expect(note(notes, "approximated", "2 buttons inside text blocks are now Button blocks")).toBe(true);
  });

  it("puts a block's button inside its card when the block has a fill of its own", () => {
    const { inner } = more({ t1: text("<p>Boxed</p>", withButton("Go", "https://example.com/go", { background_color: "#ffffff" })), t2: text("<p>Plain</p>") });
    const card = inner.find((b) => b.type === "Section");
    expect((card?.props.content as Puck[]).map((b) => b.type)).toEqual(["RichText", "Button"]);
  });

  it("keeps a Kajabi path as it is, with the usual note", () => {
    const { inner, notes } = more({ t1: text("<p>Wait</p>", withButton("Waitlist", "/resource_redirect/landing_pages/123")) });
    expect(inner[1].props.href).toBe("https://kajabi.example.test/resource_redirect/landing_pages/123");
    expect(note(notes, "approximated", "goes to a Kajabi path (/resource_redirect/landing_pages/123)")).toBe(true);
  });

  it("makes the button of an older export that has no switch, from its label and link", () => {
    const { inner } = more({ t1: text("<p>Old</p>", { btn_text: "Older", btn_action: "https://example.com/old" }), t2: text("<p>None</p>", { btn_text: "Call To Action", btn_action: "" }) });
    expect(inner.filter((b) => b.type === "Button")).toHaveLength(1);
  });

  it("asks for the link of a button that has none, and refuses an unsafe one", () => {
    const { inner, notes } = more({ t1: text("<p>x</p>", withButton("No link", "")), t2: text("<p>y</p>", withButton("Bad link", "javascript:alert(1)")) });
    expect(inner.filter((b) => b.type === "Button").map((b) => b.props.href)).toEqual(["", ""]);
    expect(note(notes, "todo", 'Button "No link" has no link')).toBe(true);
    expect(note(notes, "todo", 'Button "Bad link" has a link that can\'t be used')).toBe(true);
  });

  it("says a switched-on button with no label is left out", () => {
    const { inner, notes } = more({ t1: text("<p>x</p>", withButton("<br>", "https://example.com/x")) });
    expect(inner.some((b) => b.type === "Button")).toBe(false);
    expect(note(notes, "left_out", 'The text block "text" has a button inside it with no label')).toBe(true);
  });

  it("removes a link styled as a button from the words and makes it a Button", () => {
    const html = '<p>Before</p><p><a class="btn btn-primary" href="https://example.com/styled">Styled go</a></p><p>Read <a href="https://example.com/plain">a plain link</a>. <a class="button" href="https://example.com/inline">Inline go</a></p>';
    const { inner, notes } = more({ t1: text(html) });
    expect(inner.map((b) => b.type)).toEqual(["RichText", "Button", "Button"]);
    expect(inner[0].props.html).toContain("Before");
    expect(inner[0].props.html).toContain("a plain link");
    expect(inner[0].props.html).not.toMatch(/Styled go|Inline go|<p><\/p>/);
    expect(inner.slice(1).map((b) => b.props.label)).toEqual(["Styled go", "Inline go"]);
    expect(note(notes, "approximated", "2 buttons inside text blocks")).toBe(true);
  });

  it("does not show a button twice when the words hold it and the settings name it", () => {
    const { inner, json } = more({ t1: text('<p>Hi</p><p><a class="btn" href="https://example.com/join">Join now</a></p>', withButton("Join now", "https://example.com/join")) });
    expect(inner.filter((b) => b.type === "Button")).toHaveLength(1);
    expect(json.match(/Join now/g)).toHaveLength(1);
  });

  it("reports a button-styled link with no label", () => {
    const { notes } = more({ t1: text('<p>x</p><p><a class="btn" href="https://example.com/e"><br></a></p>') });
    expect(note(notes, "left_out", "has a button inside it with no label")).toBe(true);
  });

  it("reports pictures and embeds in the words, which the rich text drops", () => {
    const one = more({ t1: text('<p>See</p><img src="x.png">') });
    expect(note(one.notes, "left_out", 'The text block "text" has a picture or embed inside it')).toBe(true);
    const many = more({ t1: text('<p>See</p><iframe src="https://example.com/e"></iframe><video src="v.mp4"></video>') });
    expect(note(many.notes, "left_out", "has 2 pictures or embeds inside it")).toBe(true);
    expect(many.json).not.toMatch(/iframe|video/);
  });

  it("gives the same page for the same export twice", () => {
    const blocks = () => ({ t1: text("<p>One</p>", withButton("First", "/resource_redirect/offers/1")), t2: text('<p>Two</p><p><a class="btn" href="https://example.com/2">Second</a></p>') });
    expect(more(blocks()).json).toBe(more(blocks()).json);
  });
});
