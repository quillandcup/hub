import { parseFragment, serializeOuter } from "parse5";
import { BLOCK_DEFAULTS } from "@/components/landing/config";
import { safeHref, type LandingData } from "@/lib/landing/data";
import { presetPadding } from "@/lib/landing/layout";
import { sanitizeLandingData, sanitizeRichText } from "@/lib/landing/sanitize";

/**
 * Turns the content of a Kajabi page export (`config/settings_data.json`, docs/product/LANDING_PAGES.md, "Importing from
 * Kajabi") into a Puck page of our blocks. Deterministic and pure: no network, no database, no model. The export is
 * structured (sections, each with typed blocks and their settings), so the mapping is a table, and what has no
 * counterpart is reported rather than guessed. Pictures are not fetched here: a picture prop holds a placeholder
 * (`PICTURE_PREFIX` + a number) and `pictures` says where each one comes from.
 *
 * What the export does not carry, and so cannot be imported: a page title, the Kajabi form's name and fields (only
 * its id), the footer's "Powered by", fonts beyond the brand's, and anything a block does only at runtime.
 */

export const PICTURE_PREFIX = "kajabi-import-picture:";

export type ImportNote = {
  /** "approximated": mapped to the nearest thing we have; "left_out": nothing to map it to; "hidden": hidden in Kajabi, not imported; "todo": to do in the editor. */
  kind: "approximated" | "left_out" | "hidden" | "todo";
  text: string;
};

export type PictureSource = { placeholder: string; zipName?: string; url?: string };

export type KajabiMapOptions = {
  /** The Kajabi site's public address, to resolve Kajabi paths (`/resource_redirect/...`). */
  siteUrl: string;
  /** Where picture paths such as `file-uploads/sites/...` live (the Kajabi CDN), no trailing slash. */
  cdnBase: string;
  /** The year for a footer's copyright line. */
  year: number;
};

export type KajabiMapResult =
  | { ok: false; error: string }
  | { ok: true; data: LandingData; importKey: string; pictures: PictureSource[]; notes: ImportNote[]; counts: { blocks: number; hidden: number } };

type Settings = Record<string, unknown>;
type Block = { type?: unknown; name?: unknown; hidden?: unknown; settings?: Settings };
type Section = { type?: unknown; settings?: Settings; blocks?: Record<string, Block>; block_order?: unknown };
type Puck = { type: string; props: Record<string, unknown> };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const flag = (v: unknown) => v === true || v === "true";
const num = (v: unknown) => {
  const n = Number.parseFloat(str(v));
  return Number.isFinite(n) ? n : null;
};
const clean = (s: string) => s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

// ---- colours -------------------------------------------------------------------------------------------------

type Rgb = [number, number, number];
function rgb(value: unknown): Rgb | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str(value).trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(str(value).trim());
  if (fn && (fn[4] === undefined || Number(fn[4]) > 0)) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return null; // empty, transparent or unknown
}
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function nearest<K extends string>(color: Rgb, palette: Record<K, Rgb>): { key: K; exact: boolean } {
  let best = { key: Object.keys(palette)[0] as K, d: Infinity };
  for (const key of Object.keys(palette) as K[]) {
    const d = distance(color, palette[key]);
    if (d < best.d) best = { key, d };
  }
  return { key: best.key, exact: best.d <= 12 };
}

/** Section backgrounds we offer (src/components/landing/theme.ts) with the colour each has. */
const SECTION_COLORS = {
  white: [255, 255, 255],
  cream: [244, 236, 232],
  blush: [234, 218, 218],
  mist: [199, 223, 223],
  plum: [139, 62, 100],
  brownMid: [142, 88, 61],
  brown: [72, 40, 21],
  charcoal: [77, 77, 77],
} as const satisfies Record<string, Rgb>;
/** Button colours we offer: plum, light (cream) and brown. */
const BUTTON_COLORS = { plum: [166, 77, 121], light: [244, 236, 232], brown: [142, 88, 61] } as const satisfies Record<string, Rgb>;

// ---- links, pictures -----------------------------------------------------------------------------------------

/** An https address, or a Kajabi path resolved against the site, or "" when it is neither (mailto and anchors stay as they are). */
function resolveLink(value: unknown, siteUrl: string): string {
  const v = str(value).trim();
  if (!v) return "";
  if (v.startsWith("/") && !v.startsWith("//")) return safeHref(`${siteUrl.replace(/\/$/, "")}${v}`);
  return safeHref(v);
}

class Pictures {
  readonly list: PictureSource[] = [];
  constructor(private readonly cdnBase: string) {}

  /** The placeholder for a picture setting (an `assets/` file in the export, an address, or a Kajabi upload path), or null when empty. */
  add(value: unknown): string | null {
    const v = str(value).trim();
    if (!v) return null;
    const existing = this.list.findIndex((p) => p.zipName === v || p.url === v);
    if (existing >= 0) return this.list[existing].placeholder;
    const placeholder = `${PICTURE_PREFIX}${this.list.length + 1}`;
    if (/^https:\/\//i.test(v)) this.list.push({ placeholder, url: v });
    else if (/^assets\//.test(v)) this.list.push({ placeholder, zipName: v.slice("assets/".length) });
    else this.list.push({ placeholder, url: `${this.cdnBase}/${v.replace(/^\/+/, "")}` });
    return placeholder;
  }
}

// ---- text ----------------------------------------------------------------------------------------------------

interface Node5 {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: Node5[];
  attrs?: { name: string; value: string }[];
}

function textOf(node: Node5): string {
  if (node.nodeName === "#text") return node.value ?? "";
  if (node.nodeName === "#comment") return "";
  if (node.tagName === "br") return " ";
  return (node.childNodes ?? []).map(textOf).join("");
}
const attr = (node: Node5, name: string) => node.attrs?.find((a) => a.name === name)?.value ?? "";
const styleAlign = (node: Node5): "left" | "center" | "right" | null => {
  const m = /text-align:\s*(left|center|right)/i.exec(attr(node, "style"));
  return m ? (m[1].toLowerCase() as "left" | "center" | "right") : null;
};
const alignOf = (v: unknown): "left" | "center" | "right" => (v === "center" || v === "right" ? v : "left");

/**
 * A text block's HTML as blocks: h1 to h4 become Heading blocks (an h4 as our smallest, h3), a rule becomes a
 * Divider, and everything between is cleaned rich text. Empty paragraphs (Kajabi leaves comment markers) are dropped.
 */
function textBlocks(html: string, align: "left" | "center" | "right", id: (type: string) => string): Puck[] {
  const out: Puck[] = [];
  let pending: string[] = [];
  const flush = () => {
    const rich = sanitizeRichText(pending.join(""));
    pending = [];
    const fragment = parseFragment(rich).childNodes as unknown as Node5[];
    if (clean(fragment.map(textOf).join("")) || /<hr/.test(rich)) out.push({ type: "RichText", props: { id: id("RichText"), html: rich, align: align === "center" ? "center" : "left" } });
  };
  const walk = (nodes: Node5[]) => {
    for (const node of nodes) {
      const tag = node.tagName;
      if (node.nodeName === "#comment") continue;
      if (node.nodeName === "#text") {
        if (clean(node.value ?? "")) pending.push(`<p>${clean(node.value ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</p>`);
        continue;
      }
      if (tag && /^h[1-4]$/.test(tag)) {
        const text = clean(textOf(node));
        if (!text) continue;
        flush();
        const level = tag === "h1" ? "h1" : tag === "h2" ? "h2" : "h3";
        out.push({ type: "Heading", props: { id: id("Heading"), text, level, align: styleAlign(node) ?? align } });
      } else if (tag === "hr" || (tag === "div" && (node.childNodes ?? []).every((c) => c.tagName === "hr" || (c.nodeName === "#text" && !clean(c.value ?? ""))) && (node.childNodes ?? []).some((c) => c.tagName === "hr"))) {
        flush();
        out.push({ type: "Divider", props: { id: id("Divider"), look: "short" } });
      } else if (tag === "div") {
        walk(node.childNodes ?? []);
      } else {
        pending.push(serializeOuter(node as never));
      }
    }
  };
  walk(parseFragment(html.replace(/&nbsp;|\u00a0/g, " ")).childNodes as unknown as Node5[]);
  flush();
  return out;
}

// ---- the page ------------------------------------------------------------------------------------------------

const idNumber = (id: string) => Number.parseInt(id, 10);

export function mapKajabiPage(settingsData: unknown, options: KajabiMapOptions): KajabiMapResult {
  const current = isObject(settingsData) && isObject(settingsData.current) ? settingsData.current : null;
  const sections = current && isObject(current.sections) ? (current.sections as Record<string, Section>) : null;
  const order = current && Array.isArray(current.content_for_index) ? current.content_for_index.filter((s): s is string => typeof s === "string" && s !== "") : [];
  if (!current || !sections || order.length === 0) return { ok: false, error: "This doesn't look like a Kajabi page export: no page sections were found in it." };

  const notes: ImportNote[] = [];
  const pictures = new Pictures(options.cdnBase);
  let counter = 0;
  const id = (type: string) => `${type}-import-${++counter}`;
  const content: Puck[] = [];
  const root: Record<string, unknown> = { showHeader: false, showFooter: false };
  let blockCount = 0;
  let hiddenCount = 0;
  const allBlockIds: string[] = [];
  const themeRadius = num(current.btn_border_radius);

  // The header's logo is the page's first picture (a banner in the page's own colour, as the export has it).
  const header = sections.header;
  const headerHidden = header && isObject(header.settings) && flag(header.settings.hide_on_desktop) && flag(header.settings.hide_on_mobile);
  let headerLogo: Puck | null = null;
  if (header && !headerHidden) {
    for (const key of Array.isArray(header.block_order) ? (header.block_order as string[]) : []) {
      const b = header.blocks?.[key];
      const s = b?.settings ?? {};
      if (!b || flag(b.hidden)) continue;
      if (b.type === "logo" && str(s.logo_type) !== "text" && str(s.logo)) {
        const width = num(s.logo_width) ?? 300;
        if (!clean(str(s.image_alt)) || clean(str(s.image_alt)) === "Header Logo") notes.push({ kind: "todo", text: "The picture at the top has no description: add one in the editor (or mark it decorative) before publishing." });
        headerLogo = {
          type: "Image",
          props: { id: id("Image"), imageAssetId: pictures.add(s.logo), alt: clean(str(s.image_alt)) === "Header Logo" ? "" : clean(str(s.image_alt)), decorative: false, size: width <= 220 ? "small" : width <= 480 ? "medium" : "full", rounded: false, align: str(s.alignment) === "left" ? "left" : str(s.alignment) === "right" ? "right" : "center" },
        };
      } else if (b.type === "logo") notes.push({ kind: "left_out", text: "The header shows the site name as text; it is not imported." });
      else notes.push({ kind: "left_out", text: `Header block "${clean(str(b.name)) || str(b.type)}" (${str(b.type)}) is not imported.` });
    }
  }

  let first = true;
  for (const sectionId of order) {
    const section = sections[sectionId];
    if (!section || !isObject(section) || !isObject(section.blocks)) {
      notes.push({ kind: "left_out", text: `Section ${sectionId} is not in the export; skipped.` });
      continue;
    }
    const s = section.settings ?? {};
    const blocks = section.blocks;
    const blockOrder = (Array.isArray(section.block_order) ? section.block_order : Object.keys(blocks)).filter((k): k is string => typeof k === "string" && k in blocks);
    allBlockIds.push(...blockOrder);
    if (str(section.type) !== "section") {
      notes.push({ kind: "left_out", text: `Section ${sectionId} is a "${str(section.type)}" section, which is not imported (${blockOrder.length} blocks).` });
      continue;
    }
    if (flag(s.hide_on_desktop) && flag(s.hide_on_mobile)) {
      notes.push({ kind: "hidden", text: `Section ${sectionId} is hidden in Kajabi on every device (${blockOrder.length} blocks); not imported.` });
      hiddenCount += blockOrder.length;
      continue;
    }

    const inner: Puck[] = [];
    const widths: number[] = [];
    let boxed = false;
    if (first && headerLogo) inner.push(headerLogo);
    first = false;

    for (const key of blockOrder) {
      const block = blocks[key];
      const b = (isObject(block.settings) ? block.settings : {}) as Settings;
      const name = clean(str(block.name)) || str(block.type);
      const type = str(block.type);
      const label = type === "cta" ? clean(textOfHtml(str(b.btn_text))) || name : name;
      if (flag(block.hidden) || (flag(b.hide_on_desktop) && flag(b.hide_on_mobile))) {
        hiddenCount++;
        const link = type === "cta" ? resolveLink(b.btn_action, options.siteUrl) || clean(str(b.btn_action)) : "";
        notes.push({ kind: "hidden", text: `Hidden in Kajabi, not imported: ${type === "cta" ? `button "${label}"${link ? ` (${link})` : ""}` : `${name} (${type})`}.` });
        continue;
      }
      if (flag(b.hide_on_desktop) || flag(b.hide_on_mobile)) notes.push({ kind: "approximated", text: `"${label}" is hidden on ${flag(b.hide_on_desktop) ? "desktop" : "phones"} only in Kajabi; here it shows everywhere.` });
      if (str(b.reveal_event)) notes.push({ kind: "left_out", text: `"${label}" appears after a delay or an event in Kajabi; here it is always shown.` });
      const width = num(b.width);
      const before = inner.length;

      if (type === "text") {
        inner.push(...textBlocks(str(b.text), alignOf(b.text_align), id));
        if (str(b.btn_text) && str(b.btn_action)) notes.push({ kind: "left_out", text: `The text block "${name}" has a button inside it; add a Button block if you want it.` });
      } else if (type === "image") {
        const ref = pictures.add(b.image);
        if (!ref) {
          notes.push({ kind: "left_out", text: `The picture block "${name}" has no picture.` });
          continue;
        }
        const alt = clean(str(b.image_alt));
        if (!alt) notes.push({ kind: "todo", text: `A picture has no description: add one in the editor (or mark it decorative) before publishing.` });
        if (str(b.img_action)) notes.push({ kind: "left_out", text: `A picture that links somewhere in Kajabi is a plain picture here.` });
        inner.push({ type: "Image", props: { id: id("Image"), imageAssetId: ref, alt, decorative: false, size: width !== null && width <= 3 ? "small" : width !== null && width <= 8 ? "medium" : "full", rounded: false, align: "center" } });
      } else if (type === "cta") {
        const bg = rgb(b.btn_background_color);
        const fg = rgb(b.btn_text_color);
        const outline = str(b.btn_style) === "outline" || (!bg && Boolean(fg));
        const source = outline ? fg : bg;
        const picked = source ? nearest(source, BUTTON_COLORS) : { key: "plum" as const, exact: true };
        if (source && !picked.exact) notes.push({ kind: "approximated", text: `Button "${label}": its colour is shown as the nearest of our three button colours.` });
        const href = resolveLink(b.btn_action, options.siteUrl);
        const raw = clean(str(b.btn_action));
        if (!href) notes.push({ kind: "todo", text: `Button "${label}" has ${raw ? "a link that can't be used here" : "no link"}: set its link in the editor.` });
        else if (raw.startsWith("/")) notes.push({ kind: "approximated", text: `Button "${label}" goes to a Kajabi path (${raw}) through the Kajabi site, which works while Kajabi stays; point it at the final address when the page moves.` });
        const radius = num(b.btn_border_radius) ?? themeRadius ?? 100;
        inner.push({
          type: "Button",
          props: { id: id("Button"), label, href, look: outline ? "outline" : "solid", color: picked.key, shape: radius >= 30 ? "pill" : "rect", align: alignOf(b.text_align) === "left" ? "left" : alignOf(b.text_align) === "right" ? "right" : "center", full: str(b.btn_width) === "full" },
        });
      } else if (type === "form") {
        inner.push(...textBlocks(str(b.text), alignOf(b.text_align), id));
        const formId = clean(str(b.form));
        notes.push({ kind: "todo", text: `Choose the Kajabi form for the sign-up form${formId ? ` (the export names form ${formId}, not its name)` : ""} in the editor; until then it isn't shown to visitors.` });
        notes.push({ kind: "todo", text: "The export doesn't list the form's fields. The sign-up form asks for name and email; turn on the Instagram handle in the editor if the Kajabi form asks for it." });
        const thanks = resolveLink(b.thank_you, options.siteUrl);
        inner.push({
          type: "OptInForm",
          props: { id: id("OptInForm"), ...BLOCK_DEFAULTS.OptInForm, kajabiFormId: "", buttonLabel: clean(str(b.btn_text)) || BLOCK_DEFAULTS.OptInForm.buttonLabel, reassurance: clean(str(b.disclaimer_text)), href: thanks },
        });
      } else {
        notes.push({ kind: "left_out", text: `"${name}" (${type || "unknown"} block) is not imported: it has no counterpart here yet.` });
        continue;
      }
      blockCount += inner.length - before;
      if (width !== null) widths.push(width);
      if (rgb(b.background_color) && (type === "text" || type === "form")) boxed = true;
    }

    // The column: the most common block width (Kajabi sets it per block in twelfths), as the nearest of our widths.
    const counts = new Map<number, number>();
    for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 12;
    const bgColor = rgb(s.background_color);
    const bgPick = bgColor ? nearest(bgColor, SECTION_COLORS) : { key: "white" as const, exact: true };
    if (bgColor && !bgPick.exact) notes.push({ kind: "approximated", text: `Section background ${str(s.background_color)} is shown as the nearest of our colours.` });
    const bgPicture = str(s.bg_type).includes("image") ? pictures.add(s.bg_image) : null;
    if (str(s.bg_video)) notes.push({ kind: "left_out", text: "A section background video is not imported." });
    if (bgPicture) notes.push({ kind: "approximated", text: "A dark shade was added over the section's background picture so the text stays readable." });
    const padding = ((num(isObject(s.padding_desktop) ? s.padding_desktop.top : 0) ?? 0) + (num(isObject(s.padding_desktop) ? s.padding_desktop.bottom : 0) ?? 0)) / 2;
    content.push({
      type: "Section",
      props: {
        ...BLOCK_DEFAULTS.Section,
        id: id("Section"),
        background: bgPick.key,
        backgroundImageAssetId: bgPicture ?? undefined,
        overlay: bgPicture ? "dark" : "none",
        width: flag(s.full_width) ? "full" : common <= 6 ? "narrow" : common <= 9 ? "medium" : "wide",
        ...presetPadding(padding >= 60 ? "large" : "medium"),
        align: str(s.horizontal) === "left" ? "left" : "center",
        card: boxed,
        content: inner,
      },
    });
  }

  if (content.length === 0) return { ok: false, error: "Nothing in this export could be imported: every section was hidden or of a kind we don't import yet." };

  const footer = sections.footer;
  if (footer && isObject(footer.blocks)) {
    for (const key of Array.isArray(footer.block_order) ? (footer.block_order as string[]) : []) {
      const b = footer.blocks[key];
      if (!b || flag(b.hidden)) continue;
      if (b.type === "copyright" && clean(str(b.settings?.copyright))) {
        root.showFooter = true;
        root.footerText = `© ${options.year} ${clean(str(b.settings?.copyright))}`;
        notes.push({ kind: "approximated", text: "The footer shows the copyright line in the Hub's footer colour; the year is set today and doesn't roll over." });
      } else notes.push({ kind: "left_out", text: `Footer block "${clean(str(b.name)) || str(b.type)}" (${str(b.type)}) is not imported.` });
    }
  }
  notes.push({ kind: "approximated", text: "Fonts and exact spacing follow the Hub's theme, not Kajabi's." });

  const firstBlock = allBlockIds.map((b) => ({ b, n: idNumber(b) })).filter((x) => Number.isFinite(x.n)).sort((a, b) => a.n - b.n)[0]?.b ?? allBlockIds[0] ?? "";
  const data = sanitizeLandingData({ content, root: { props: root } });
  return { ok: true, data, importKey: `kajabi:${order[0]}:${firstBlock}`, pictures: pictures.list, notes, counts: { blocks: blockCount, hidden: hiddenCount } };
}

/** The text of a snippet of HTML (a button label with a `<br>`), whitespace as single spaces. */
function textOfHtml(html: string): string {
  return clean(textOf({ nodeName: "#document-fragment", childNodes: parseFragment(html.replace(/&nbsp;/g, " ")).childNodes as unknown as Node5[] }));
}
