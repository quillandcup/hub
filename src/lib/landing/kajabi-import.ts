import { createHash } from "node:crypto";
import { parseFragment, serialize, serializeOuter } from "parse5";
import { BLOCK_DEFAULTS } from "@/components/landing/config";
import { ITEM_LIMITS } from "@/components/landing/item-limits";
import type { SocialNetwork } from "@/components/landing/social-networks";
import { safeHref, type LandingData } from "@/lib/landing/data";
import { describeTarget } from "@/lib/landing/countdown";
import type { KajabiLookups, KajabiReferences } from "@/lib/landing/kajabi-lookups";
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
 *
 * A page's identity: the export has no page id, and the ids it does carry for a section or block belong to the template
 * or to the page it was cloned from, so two different pages can share their first section and earliest block. The
 * layout is what tells them apart: the ordered section ids and, in each, the ordered block ids with their types
 * (`layoutFingerprint`). Text is not in it, so a re-export after edits to the wording is the same page; adding or
 * removing a block makes a different layout. Two pages cloned from each other and differing only in their text still
 * share a fingerprint, so a match is only ever a suggestion the admin confirms (kajabi-import-service.ts).
 */

export const PICTURE_PREFIX = "kajabi-import-picture:";

/**
 * The start of a stored key made by `mapKajabiPage`. The first version of the key (`kajabi:<section>:<block>`) collided
 * between different pages; keys in that form are never matched again.
 */
export const IMPORT_KEY_PREFIX = "kajabi2:";

/** The key a page made from this layout gets; a second page with the same layout gets `#2`, `#3`, ... after it (a key is unique per page). */
export const layoutKeyOf = (fingerprint: string) => `${IMPORT_KEY_PREFIX}${fingerprint}`;

/** True when a stored key belongs to this layout: the key itself or one of its numbered twins. Old-format keys never do. */
export function keyHasLayout(storedKey: string | null | undefined, fingerprint: string): boolean {
  if (!storedKey) return false;
  const base = layoutKeyOf(fingerprint);
  return storedKey === base || (storedKey.startsWith(`${base}#`) && /^\d+$/.test(storedKey.slice(base.length + 1)));
}

/** The first of `base`, `base#2`, `base#3`, ... that is not in `used`. */
export function freeImportKey(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}#${n}`)) return `${base}#${n}`;
}

/** What a page starts with: its first heading and its first few lines of text, to tell one export from another. */
export type PageStart = { heading: string; lines: string[] };

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
  /** Where Kajabi keeps courses and checkout (`kajabiCoursesUrl`): the link of a Kajabi offer the Hub doesn't know. */
  coursesUrl: string;
  /** What a lookup found for the export's references (kajabi-lookups.ts); without it the mapping is offline and what needs one keeps its to-do. */
  lookups?: KajabiLookups;
};

export type KajabiMapResult =
  | { ok: false; error: string }
  | { ok: true; data: LandingData; layout: string; importKey: string; start: PageStart; suggestedTitle: string; pictures: PictureSource[]; notes: ImportNote[]; counts: { blocks: number; hidden: number }; references: KajabiReferences; /** The id of the header logo's Image block, if the page has one (its description is the brand name). */ logoBlockId: string | null };

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
/** The opacity of a colour value: 1 for hex and `rgb()`, the alpha of `rgba()`, 0 for empty or transparent. */
function alphaOf(value: unknown): number {
  const text = str(value).trim();
  if (/^#/.test(text)) return rgb(text) ? 1 : 0;
  const fn = /^rgba?\(\s*\d+[\s,]+\d+[\s,]+\d+(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(text);
  if (!fn) return 0;
  return fn[1] === undefined ? 1 : Math.min(1, Math.max(0, Number(fn[1])));
}
/** Perceived lightness, 0 (black) to 1 (white). */
const lightness = (c: Rgb) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
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
    const existing = this.list.findIndex((p) => p.zipName === v.replace(/^assets\//, "") || p.url === v);
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
  if (node.tagName && NOT_TEXT.has(node.tagName)) return "";
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
      if (tag && /^h[1-6]$/.test(tag)) {
        const text = clean(textOf(node));
        if (!text) continue;
        flush();
        const level = tag === "h1" ? "h1" : tag === "h2" ? "h2" : "h3"; // h4 to h6 are our smallest heading
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

/** Elements the rich text cannot hold (the sanitizer drops them): a picture, a player, an embed. */
const MEDIA_TAGS = new Set(["img", "picture", "svg", "video", "audio", "iframe", "embed", "object"]);

type TextButton = { label: string; href: string };

/** A link dressed as a button in Kajabi's text: its class says so ("btn", "button"). */
const isButtonAnchor = (node: Node5) => node.tagName === "a" && /(^|[\s_-])(btn|button)([\s_-]|$)/i.test(attr(node, "class"));

/**
 * A text block's HTML without the links that are buttons (they come back as Button blocks, so the label is not shown
 * twice), and a count of the pictures and embeds in it, which the rich text drops.
 */
function splitTextButtons(html: string): { html: string; anchors: TextButton[]; media: number } {
  const root = { nodeName: "#document-fragment", childNodes: parseFragment(html.replace(/&nbsp;|\u00a0/g, " ")).childNodes as unknown as Node5[] } as Node5;
  const anchors: TextButton[] = [];
  const removedFrom = new Set<Node5>();
  let media = 0;
  const walk = (parent: Node5) => {
    const kept: Node5[] = [];
    for (const node of parent.childNodes ?? []) {
      if (node.tagName && MEDIA_TAGS.has(node.tagName)) media++;
      if (isButtonAnchor(node)) {
        anchors.push({ label: clean(textOf(node)), href: attr(node, "href") });
        continue;
      }
      walk(node);
      // A paragraph or line that held only a button is gone with it.
      const emptied = removedFrom.has(node) && (node.childNodes ?? []).length === 0 && ["p", "div", "span"].includes(node.tagName ?? "");
      if (!emptied) kept.push(node);
    }
    if (kept.length !== (parent.childNodes ?? []).length) removedFrom.add(parent);
    parent.childNodes = kept;
  };
  walk(root);
  return { html: serialize(root as never), anchors, media };
}

// ---- blocks beyond text, pictures and forms ------------------------------------------------------------------

type Ctx = {
  notes: ImportNote[];
  pictures: Pictures;
  id: (type: string) => string;
  siteUrl: string;
  coursesUrl: string;
  themeRadius: number | null;
  lookups: KajabiLookups | undefined;
  /** What the export refers to that only a lookup can answer (reported with the result). */
  refs: { landingPageIds: Set<string>; offerCodes: Set<string>; countdowns: KajabiReferences["countdowns"] };
  /** Links turned into addresses of their own, counted so the report says it once. */
  moved: { pages: Map<string, number>; knownOffers: number; otherOffers: number };
};

const settingsOf = (block: Block): Settings => (isObject(block.settings) ? block.settings : {});
const isHiddenBlock = (block: Block) => flag(block.hidden) || (flag(settingsOf(block).hide_on_desktop) && flag(settingsOf(block).hide_on_mobile));

/** This block's key and those of the visible blocks of the same kind right after it (hidden ones in between are skipped; another kind ends the run). */
function sameKind(order: string[], blocks: Record<string, Block>, index: number, kind: string): string[] {
  const keys: string[] = [];
  for (const key of order.slice(index)) {
    if (isHiddenBlock(blocks[key])) continue;
    if (str(blocks[key].type) !== kind) break;
    keys.push(key);
  }
  return keys;
}

/** What Kajabi does to a block on one device only, or after a delay, which has no counterpart here. */
function liveNotes(ctx: Ctx, b: Settings, label: string) {
  if (flag(b.hide_on_desktop) || flag(b.hide_on_mobile)) ctx.notes.push({ kind: "approximated", text: `"${label}" is hidden on ${flag(b.hide_on_desktop) ? "desktop" : "phones"} only in Kajabi; here it shows everywhere.` });
  if (str(b.reveal_event)) ctx.notes.push({ kind: "left_out", text: `"${label}" appears after a delay or an event in Kajabi; here it is always shown.` });
}

/** Kajabi's internal redirects: to the current address of one of its pages, and to an offer's checkout. */
const PAGE_REDIRECT = /^\/resource_redirect\/landing_pages\/(\d{1,20})\/?$/;
const OFFER_REDIRECT = /^\/resource_redirect\/offers\/([A-Za-z0-9]{3,40})\/?$/;

/**
 * A link for a button or a card: usable as is, resolved through the Kajabi site, or empty (and said). Kajabi's redirect to one of its pages
 * becomes that page's own path when the lookup found it (kajabi-lookups.ts), and a redirect to an offer becomes the offer's checkout
 * address (the Hub's own record of it, or else the same redirect on the courses site, where Kajabi stays).
 */
function checkedLink(ctx: Ctx, label: string, action: unknown, what: string): string {
  const raw = clean(str(action));
  const page = PAGE_REDIRECT.exec(raw);
  if (page) {
    ctx.refs.landingPageIds.add(page[1]);
    const path = ctx.lookups?.pagePaths[page[1]];
    if (path && safeHref(path)) {
      ctx.moved.pages.set(path, (ctx.moved.pages.get(path) ?? 0) + 1);
      return path;
    }
  }
  const offer = OFFER_REDIRECT.exec(raw);
  if (offer) {
    ctx.refs.offerCodes.add(offer[1]);
    const known = ctx.lookups?.offerLinks[offer[1]];
    const href = known && safeHref(known) ? known : safeHref(`${ctx.coursesUrl.replace(/\/$/, "")}/resource_redirect/offers/${offer[1]}`);
    if (href) {
      ctx.moved[known ? "knownOffers" : "otherOffers"] += 1;
      return href;
    }
  }
  const href = resolveLink(action, ctx.siteUrl);
  if (!href) ctx.notes.push({ kind: "todo", text: `${what} "${label}" has ${raw ? "a link that can't be used here" : "no link"}: set its link in the editor.` });
  else if (raw.startsWith("/")) ctx.notes.push({ kind: "approximated", text: `${what} "${label}" goes to a Kajabi path (${raw}) through the Kajabi site, which works while Kajabi stays; point it at the final address when the page moves.` });
  return href;
}

function makeButton(ctx: Ctx, b: Settings, label: string): Puck {
  const bg = rgb(b.btn_background_color);
  const fg = rgb(b.btn_text_color);
  const outline = str(b.btn_style) === "outline" || (!bg && Boolean(fg));
  const source = outline ? fg : bg;
  const picked = source ? nearest(source, BUTTON_COLORS) : { key: "plum" as const, exact: true };
  if (source && !picked.exact) ctx.notes.push({ kind: "approximated", text: `Button "${label}": its colour is shown as the nearest of our three button colours.` });
  const href = checkedLink(ctx, label, b.btn_action, "Button");
  const radius = num(b.btn_border_radius) ?? ctx.themeRadius ?? 100;
  return {
    type: "Button",
    props: { id: ctx.id("Button"), label, href, look: outline ? "outline" : "solid", color: picked.key, shape: radius >= 30 ? "pill" : "rect", align: alignOf(b.text_align) === "left" ? "left" : alignOf(b.text_align) === "right" ? "right" : "center", full: str(b.btn_width) === "full" },
  };
}

/**
 * The buttons of a text block, to follow its text. Kajabi keeps one in the block's settings (`use_btn` switches it on;
 * the label, link, colours, style and width are the `btn_*` settings, the same ones a call-to-action block has, and
 * they are there with placeholder values even when it is off), and a link in the words can be styled as a button.
 * One that has no label cannot be made and is said.
 */
function mapTextButtons(ctx: Ctx, b: Settings, name: string, anchors: TextButton[]): Puck[] {
  const out: Puck[] = [];
  const label = clean(textOfHtml(str(b.btn_text)));
  // An export that predates `use_btn` has the button when it has a label and a link.
  const on = b.use_btn === undefined ? Boolean(label && str(b.btn_action)) : flag(b.use_btn);
  const unreadable = `The text block "${name}" has a button inside it with no label; add a Button block if you want it.`;
  if (on && !label) ctx.notes.push({ kind: "left_out", text: unreadable });
  for (const a of anchors) {
    if (!a.label) ctx.notes.push({ kind: "left_out", text: unreadable });
    else if (!(on && a.label === label)) out.push(makeButton(ctx, { btn_text: a.label, btn_action: a.href, text_align: b.text_align }, a.label));
  }
  if (on && label) out.push(makeButton(ctx, b, label));
  return out;
}

/** Elements whose content is code or hidden, never words: skipped when reading text. */
const NOT_TEXT = new Set(["script", "style", "noscript", "template", "iframe", "object", "embed"]);
const FORMATTING = new Set(["strong", "b", "em", "i", "u", "s", "a", "img", "ul", "ol", "blockquote"]);
const hasFormatting = (node: Node5): boolean => Boolean(node.tagName && FORMATTING.has(node.tagName)) || (node.childNodes ?? []).some(hasFormatting);

/**
 * The text of a snippet of HTML as plain lines, for the blocks that hold plain text (a card's words, an answer): the
 * first heading apart, list items as lines with a bullet. `lossy` says that bold, italics, links or lists were flattened.
 */
function readText(html: string): { heading: string; lines: string[]; lossy: boolean } {
  const lines: string[] = [];
  let heading = "";
  let lossy = false;
  const walk = (nodes: Node5[]) => {
    for (const node of nodes) {
      const tag = node.tagName;
      if (node.nodeName === "#text") {
        if (clean(node.value ?? "")) lines.push(clean(node.value ?? ""));
      } else if (!tag || NOT_TEXT.has(tag)) continue;
      else if (/^h[1-6]$/.test(tag)) {
        const text = clean(textOf(node));
        if (!text) continue;
        if (heading) lines.push(text);
        else heading = text;
        lossy ||= hasFormatting(node);
      } else if (tag === "ul" || tag === "ol") {
        lossy = true;
        (node.childNodes ?? []).filter((c) => c.tagName === "li").forEach((li, i) => {
          const text = clean(textOf(li));
          if (text) lines.push(`${tag === "ol" ? `${i + 1}.` : "•"} ${text}`);
        });
      } else if (tag === "div") walk(node.childNodes ?? []);
      else {
        const text = clean(textOf(node));
        if (text) lines.push(text);
        lossy ||= hasFormatting(node);
      }
    }
  };
  walk(parseFragment(html.replace(/&nbsp;| /g, " ")).childNodes as unknown as Node5[]);
  return { heading, lines, lossy };
}

const NO_DESCRIPTION = "A picture has no description: add one in the editor (or mark it decorative) before publishing.";

/** A feature: a picture beside its words (Split), or just its words when it has no picture, then its button if it has one. */
function mapFeature(ctx: Ctx, b: Settings, name: string): Puck[] {
  const out: Puck[] = [];
  const text = str(b.text).replace(/&nbsp;| /g, " ");
  const ref = flag(b.hide_image) ? null : ctx.pictures.add(b.image);
  if (ref) {
    const alt = clean(str(b.image_alt));
    if (!alt) ctx.notes.push({ kind: "todo", text: NO_DESCRIPTION });
    if (str(b.img_action)) ctx.notes.push({ kind: "left_out", text: "A picture that links somewhere in Kajabi is a plain picture here." });
    out.push({ type: "Split", props: { id: ctx.id("Split"), imageAssetId: ref, alt, decorative: false, imageSide: "left", html: sanitizeRichText(text).replace(/<p>\s*<\/p>/g, "") } });
  } else out.push(...textBlocks(text, alignOf(b.text_align), ctx.id));
  const label = clean(textOfHtml(str(b.btn_text)));
  if (flag(b.use_btn) && label) out.push(makeButton(ctx, b, label));
  if (out.length === 0) ctx.notes.push({ kind: "left_out", text: `The feature "${name}" has no text or picture.` });
  return out;
}

const gridColumns = (n: number) => String(Math.min(4, Math.max(2, n)));

/** Cards that sit in a row become one Card grid: a picture, a title (the first heading), the rest of the words as plain lines, and the button. */
function mapCards(ctx: Ctx, cards: Settings[]): Puck[] {
  let flattened = false;
  let pictured = false;
  const items = cards.map((b) => {
    const text = readText(str(b.description));
    flattened ||= text.lossy;
    const title = text.heading || text.lines.shift() || "";
    const ref = ctx.pictures.add(b.image);
    if (ref) pictured = true;
    const label = flag(b.show_cta) ? clean(textOfHtml(str(b.btn_text))) : "";
    const href = str(b.action) ? checkedLink(ctx, title || "Card", b.action, "Card") : "";
    if (href && !label) ctx.notes.push({ kind: "todo", text: `Card "${title}" links somewhere in Kajabi as a whole; add a button label to its card in the editor to show the link.` });
    return { type: "GridCard", props: { id: ctx.id("GridCard"), imageAssetId: ref ?? undefined, alt: "", icon: "", title, description: text.lines.join("\n"), price: "", buttonLabel: label, href } };
  });
  if (pictured) ctx.notes.push({ kind: "todo", text: NO_DESCRIPTION });
  ctx.notes.push({ kind: "approximated", text: `${items.length} card${items.length === 1 ? "" : "s"} became a Card grid in the Hub's card style: their own colours, borders and shadows aren't carried over${flattened ? ", and their text is plain lines (bold, italics, links and lists are not kept)" : ""}.` });
  return [{ type: "CardGrid", props: { id: ctx.id("CardGrid"), columns: gridColumns(items.length), items } }];
}

/**
 * Pricing columns become Pricing blocks (up to three plans each, so a longer row is several blocks): the plan's name, the price
 * exactly as written, its heading and any plain paragraphs as the description, its list as what is included, and the button with the
 * export's link. Nothing is added: no price, period or link the export does not have (Kajabi has no billing-period field, so the
 * period line stays empty unless the price text carries it). A second button follows the block as a button.
 */
function mapPricing(ctx: Ctx, plans: Settings[]): Puck[] {
  const out: Puck[] = [];
  const extras: Puck[] = [];
  let flattened = false;
  let pictures = 0;
  const items = plans.map((b) => {
    const name = clean(textOfHtml(str(b.name))) || "Plan";
    if (flag(b.show_image) && str(b.image)) pictures += 1;
    const label = flag(b.show_cta) ? clean(textOfHtml(str(b.btn_text))) : "";
    const href = label ? checkedLink(ctx, label, b.btn_action, "Pricing button") : "";
    const body = readText(str(b.text));
    flattened ||= body.lossy;
    // A list under the price is what is included; any other words follow the heading as the description.
    const bullet = /^(?:•|\d+\.)\s+/;
    const features = body.lines.filter((l) => bullet.test(l)).map((l) => l.replace(bullet, ""));
    const description = [clean(textOfHtml(str(b.heading))), body.heading, ...body.lines.filter((l) => !bullet.test(l))].filter(Boolean).join("\n");
    const second = flag(b.show_secondary_cta) ? clean(textOfHtml(str(b.secondary_btn_text))) : "";
    if (second) {
      const synthesized: Settings = { btn_text: b.secondary_btn_text, btn_action: b.secondary_btn_action, btn_background_color: b.secondary_btn_background_color, btn_text_color: b.secondary_btn_text_color, btn_style: b.secondary_btn_style, btn_width: b.secondary_btn_width, btn_border_radius: b.secondary_btn_border_radius, text_align: "left" };
      extras.push(makeButton(ctx, synthesized, second));
    }
    return { type: "PricingPlan", props: { id: ctx.id("PricingPlan"), name, price: clean(str(b.price)), period: "", description, features: features.join("\n"), badge: "", featured: false, buttonLabel: label, href } };
  });
  for (let i = 0; i < items.length; i += ITEM_LIMITS.Pricing) out.push({ type: "Pricing", props: { id: ctx.id("Pricing"), items: items.slice(i, i + ITEM_LIMITS.Pricing) } });
  const seconds = extras.length;
  ctx.notes.push({
    kind: "approximated",
    text: `${items.length} pricing column${items.length === 1 ? "" : "s"} became ${out.length === 1 ? "a Pricing block" : `${out.length} Pricing blocks`} with each price as written and the button's link from the export; nothing was added, and the billing period line is empty (Kajabi has none). Their colours, borders and shadows are not carried over, and no plan is featured: choose one in the editor if you want one${flattened ? "; the text under each price is plain lines (bold, italics and links are not kept)" : ""}.${seconds > 0 ? ` ${seconds} second button${seconds === 1 ? "" : "s"} follow the block as button${seconds === 1 ? "" : "s"}.` : ""}`,
  });
  if (pictures > 0) ctx.notes.push({ kind: "left_out", text: `${pictures} pricing column picture${pictures === 1 ? "" : "s"} not imported: the Pricing block has no picture.` });
  return [...out, ...extras];
}

/**
 * Accordion items in a row become one Accordion: the heading is the title, the body what opens under it as plain lines. Kajabi's accordion
 * is a generic collapsible list, not a list of questions, so it is not made an FAQ (the FAQ block tells search engines its questions are
 * questions); someone who knows the items are questions can rebuild them as an FAQ in the editor.
 */
function mapAccordion(ctx: Ctx, entries: Settings[]): Puck {
  let flattened = false;
  const items = entries.flatMap((b) => {
    const question = clean(textOfHtml(str(b.heading)));
    const text = readText(str(b.body));
    flattened ||= text.lossy;
    if (!question) {
      ctx.notes.push({ kind: "left_out", text: "An accordion item has no heading, so it is not imported." });
      return [];
    }
    return [{ type: "AccordionItem", props: { id: ctx.id("AccordionItem"), title: question, text: [text.heading, ...text.lines].filter(Boolean).join("\n"), open: false } }];
  });
  if (flattened) ctx.notes.push({ kind: "approximated", text: "The text under each accordion item is plain lines here: bold, italics, links and lists are not kept." });
  return { type: "Accordion", props: { id: ctx.id("Accordion"), items } };
}

/**
 * The export names a Kajabi event, not its date. When the admin gave the page's address, the lookup read the date from the live page (the
 * instant Kajabi counts down to), and it is copied as it is; otherwise the countdown has none until it is set in the editor.
 */
function mapCountdown(ctx: Ctx, b: Settings, name: string, where: { sectionKey: string; blockKey: string }): Puck {
  const event = clean(str(b.event));
  const key = `${where.sectionKey}:${where.blockKey}`;
  ctx.refs.countdowns.push({ key, ...where, eventId: event });
  const found = ctx.lookups?.countdowns[key];
  if (found?.ok) {
    ctx.notes.push({
      kind: "approximated",
      text: `Countdown "${name}": the export names a Kajabi event${event ? ` (${event})` : ""}, not its date, so the date was copied from the live Kajabi page ${found.path} on ${found.readOn}: ${describeTarget(found.at)}. It is not linked to Kajabi, so change it in the editor if the date changes.${found.past ? " That time has passed, so the countdown shows zeros." : ""}`,
    });
  } else {
    ctx.notes.push({ kind: "todo", text: `Countdown "${name}": the export names a Kajabi event${event ? ` (${event})` : ""}, not its date${found ? ` (and it couldn't be copied from the live page: ${found.problem})` : ""}. Set the date in the editor; until then the countdown isn't shown to visitors.` });
  }
  if (flag(b.enable_end_action) || str(b.end_action)) ctx.notes.push({ kind: "left_out", text: `What Kajabi does when the countdown "${name}" ends (${clean(str(b.end_action)) || "an action"}) is not imported; choose what happens in the editor.` });
  return { type: "Countdown", props: { id: ctx.id("Countdown"), ...BLOCK_DEFAULTS.Countdown, targetAt: found?.ok ? found.at : "", heading: "", whenExpired: flag(b.remove_section_on_complete) ? "hide" : "zeros" } };
}

/** A Kajabi-hosted video is an id in the export, with no address to play it from; the Hub plays YouTube, Vimeo and Mux. */
function mapVideo(ctx: Ctx, b: Settings): Puck {
  const video = clean(str(b.video));
  ctx.notes.push({ kind: "todo", text: `A video${video ? ` (Kajabi video ${video})` : ""} can't be carried over: the export has only its Kajabi id, and Kajabi plays it from its own player, so there is no link to copy. Upload it to YouTube, Vimeo or Mux and paste that link into the Video block in the editor.` });
  return { type: "Video", props: { id: ctx.id("Video"), url: "", title: "" } };
}

/** Kajabi's networks that the Social icons block has (Kajabi's "twitter" is X); the rest are named in the report. */
const SOCIAL_FROM_KAJABI: Record<string, SocialNetwork> = { instagram: "instagram", facebook: "facebook", youtube: "youtube", tiktok: "tiktok", twitter: "x", linkedin: "linkedin", pinterest: "pinterest" };
const SOCIAL_LABELS: Record<string, string> = { facebook: "Facebook", twitter: "Twitter", instagram: "Instagram", youtube: "YouTube", spotify: "Spotify", linkedin: "LinkedIn", pinterest: "Pinterest", tiktok: "TikTok", apple_podcasts: "Apple Podcasts", google_podcasts: "Google Podcasts", itunes: "iTunes", snapchat: "Snapchat", vimeo: "Vimeo", soundcloud: "SoundCloud", github: "GitHub", medium: "Medium", twitch: "Twitch", rss: "RSS" };
const humanNetwork = (key: string) => SOCIAL_LABELS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * Social icons become a Social icons block: one icon link per network the export gives an address for and the block has (Instagram, Facebook,
 * YouTube, TikTok, X, LinkedIn, Pinterest), in the export's order, with its alignment and size. A network the block does not have is left out
 * and named; a link that can't be used here is kept with no address and a to-do.
 */
function mapSocialIcons(ctx: Ctx, b: Settings): Puck | null {
  const given = Object.entries(b)
    .filter(([key]) => key.startsWith("social_icon_link_"))
    .map(([key, value]) => ({ key: key.slice("social_icon_link_".length), href: resolveLink(value, ctx.siteUrl), given: clean(str(value)) }))
    .filter((l) => l.given);
  if (given.length === 0) return null;
  const known = given.filter((l) => Object.hasOwn(SOCIAL_FROM_KAJABI, l.key));
  const unknown = given.filter((l) => !Object.hasOwn(SOCIAL_FROM_KAJABI, l.key));
  if (unknown.length > 0) ctx.notes.push({ kind: "left_out", text: `Social icons for ${unknown.map((l) => humanNetwork(l.key)).join(", ")} are not imported: the Social icons block has no mark for ${unknown.length === 1 ? "that network" : "those networks"}. Add a Website link if you want one.` });
  if (known.length === 0) return null;
  for (const l of known.filter((x) => !x.href)) ctx.notes.push({ kind: "todo", text: `The ${humanNetwork(l.key)} link in the social icons can't be used here: set it in the editor.` });
  const align = str(b.horizontal) === "left" ? "left" : str(b.horizontal) === "right" ? "right" : "center";
  const size = /^(small|large)$/.test(str(b.social_icon_size)) ? str(b.social_icon_size) : "medium";
  const items = known.slice(0, ITEM_LIMITS.SocialIcons).map((l) => ({ type: "SocialLink", props: { id: ctx.id("SocialLink"), network: SOCIAL_FROM_KAJABI[l.key], url: l.href } }));
  ctx.notes.push({ kind: "approximated", text: `Social icons became a Social icons block (${known.map((l) => humanNetwork(l.key)).join(", ")}) with the Hub's own simple marks and the theme's colours; Kajabi's icon colours and backgrounds are not carried over, and the links open in a new tab.` });
  return { type: "SocialIcons", props: { id: ctx.id("SocialIcons"), items, align, size } };
}

/** Why embedded code is not carried over, or null when it is plain markup the rich text rules can hold. Anything that runs or loads something is refused. */
function unsafeCodeReason(code: string): string | null {
  if (/<\s*(script|iframe|style|object|embed|form|link|meta|base|svg|math|template|input|button|textarea|frame|applet)\b/i.test(code) || /\son[a-z]+\s*=/i.test(code) || /javascript\s*:/i.test(code)) return "runs a script or loads another site";
  return null;
}
const codeHosts = (code: string) => [...code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());

// ---- text colours -----------------------------------------------------------------------------------------

/** The brand plum Kajabi pages use for coloured text (the theme's primary here is a green, but the text colour chosen in the editor is this). */
const PLUM_TEXT: Rgb = [166, 77, 121];

/** How much of a block's text each colour (from `style="color: ..."`, inherited by what is inside) covers, by number of characters. "" is the page's own colour. */
function textColourShares(html: string): Map<string, number> {
  const shares = new Map<string, number>();
  const walk = (nodes: Node5[], inherited: string) => {
    for (const node of nodes) {
      if (node.nodeName === "#text") {
        const n = clean(node.value ?? "").length;
        if (n > 0) shares.set(inherited, (shares.get(inherited) ?? 0) + n);
        continue;
      }
      if (!node.tagName || NOT_TEXT.has(node.tagName)) continue;
      const m = /(?:^|;)\s*color:\s*(#[0-9a-f]{3,6}|rgba?\([^)]*\))/i.exec(attr(node, "style"));
      walk(node.childNodes ?? [], m && rgb(m[1]) ? m[1].toLowerCase() : inherited);
    }
  };
  walk(parseFragment(html.replace(/&nbsp;|\u00a0/g, " ")).childNodes as unknown as Node5[], "");
  return shares;
}

/**
 * The text tone of a section from the text blocks in it: "plum" when plum covers at least half the words, else the theme's own. Any
 * other colour that isn't a grey is not carried over, and said once.
 */
function sectionTextTone(htmls: string[]): { tone: "auto" | "plum"; others: string[] } {
  const total = new Map<string, number>();
  for (const html of htmls) for (const [k, v] of textColourShares(html)) total.set(k, (total.get(k) ?? 0) + v);
  let all = 0;
  let plum = 0;
  const others = new Set<string>();
  for (const [colour, n] of total) {
    all += n;
    const c = colour ? rgb(colour) : null;
    if (!c) continue;
    if (distance(c, PLUM_TEXT) <= 60) plum += n;
    else if (Math.max(...c) - Math.min(...c) > 24) others.add(colour);
  }
  return { tone: all > 0 && plum / all >= 0.5 ? "plum" : "auto", others: [...others] };
}

// ---- the page ------------------------------------------------------------------------------------------------

/** A card's colour and softness from a Kajabi fill: the nearest theme colour (white and solid is the standard card), and a see-through fill lets the picture show faintly. */
function cardStyle(notes: ImportNote[], fill: unknown): { cardColor: string; cardSoft: boolean } {
  const color = rgb(fill);
  if (!color) return { cardColor: "default", cardSoft: false };
  const alpha = alphaOf(fill);
  // A see-through fill is judged as it looks over a light page: the colour mixed with white by its opacity.
  const shown = color.map((c) => Math.round(c * alpha + 255 * (1 - alpha))) as Rgb;
  const pick = nearest(shown, SECTION_COLORS);
  if (!pick.exact) notes.push({ kind: "approximated", text: `The card colour ${str(fill)} is shown as the nearest of our colours.` });
  if (alpha < 0.95) notes.push({ kind: "approximated", text: "A card is a little see-through here (80%), where Kajabi's is a different amount." });
  return { cardColor: pick.key === "white" && alpha >= 0.95 ? "default" : pick.key, cardSoft: alpha < 0.95 };
}

/** A Section's padding with no space above and below (the card Section inside a band that has the space already). */
const zeroVertical = () => {
  const p = presetPadding("medium");
  return { paddingDesktop: { ...p.paddingDesktop, top: 0, bottom: 0 }, paddingMobile: { ...p.paddingMobile, top: 0, bottom: 0 } };
};

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
  const themeRadius = num(current.btn_border_radius);
  const ctx: Ctx = {
    notes,
    pictures,
    id,
    siteUrl: options.siteUrl,
    coursesUrl: options.coursesUrl,
    themeRadius,
    lookups: options.lookups,
    refs: { landingPageIds: new Set(), offerCodes: new Set(), countdowns: [] },
    moved: { pages: new Map(), knownOffers: 0, otherOffers: 0 },
  };
  /** Embedded code that runs a script or loads another site: never imported, said once for the page. */
  const leftOutCode = { count: 0, hosts: new Set<string>() };
  /** Buttons found inside text blocks and made into Button blocks after their text. */
  let textButtons = 0;

  // The header's logo is the page's first picture (a banner in the page's own colour, as the export has it).
  const header = sections.header;
  const headerHidden = header && isObject(header.settings) && flag(header.settings.hide_on_desktop) && flag(header.settings.hide_on_mobile);
  let headerLogo: Puck | null = null;
  /** The logo's file says it is the white version (Kajabi keeps a dark one for pale pages; the export has only the one in use). */
  let headerLogoWhite = false;
  const headerOverlays = Boolean(header && isObject(header.settings) && str(header.settings.position) === "overlay");
  if (header && !headerHidden) {
    for (const key of Array.isArray(header.block_order) ? (header.block_order as string[]) : []) {
      const b = header.blocks?.[key];
      const s = b?.settings ?? {};
      if (!b || flag(b.hidden)) continue;
      if (b.type === "logo" && str(s.logo_type) !== "text" && str(s.logo)) {
        const width = num(s.logo_width) ?? 300;
        headerLogoWhite = /white/i.test(str(s.logo).split("/").pop() ?? "");
        if (!clean(str(s.image_alt)) || clean(str(s.image_alt)) === "Header Logo") notes.push({ kind: "todo", text: "The picture at the top has no description: add one in the editor (or mark it decorative) before publishing." });
        headerLogo = {
          type: "Image",
          props: { id: id("Image"), imageAssetId: pictures.add(s.logo), alt: clean(str(s.image_alt)) === "Header Logo" ? "" : clean(str(s.image_alt)), decorative: false, size: width <= 320 ? "small" : width <= 480 ? "medium" : "full", rounded: false, align: str(s.alignment) === "left" ? "left" : str(s.alignment) === "right" ? "right" : "center" },
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
    let cardFill: unknown = "";
    // A fill on every block of the section is the section's card; a fill on only some is a card around each of those blocks.
    const shown = blockOrder.filter((k) => !flag(blocks[k].hidden) && !(flag(settingsOf(blocks[k]).hide_on_desktop) && flag(settingsOf(blocks[k]).hide_on_mobile)));
    const hasFill = (k: string) => ["text", "form"].includes(str(blocks[k].type)) && rgb(settingsOf(blocks[k]).background_color) !== null;
    const wholeCard = shown.length > 0 && shown.every(hasFill);
    const words: string[] = [];
    // The header's logo is over the page's top picture in Kajabi ("overlay"): where the picture is this section's, it stays out of the card.
    const logoOutside = first && headerLogo !== null && headerOverlays && (str(s.bg_type).includes("image") || str(s.bg_type).includes("video")) && Boolean(str(s.bg_image));
    if (first && headerLogo && !logoOutside) inner.push(headerLogo);
    first = false;

    const consumed = new Set<string>();
    for (const [index, key] of blockOrder.entries()) {
      if (consumed.has(key)) continue;
      const block = blocks[key];
      const b = settingsOf(block);
      const name = clean(str(block.name)) || str(block.type);
      const type = str(block.type);
      const label = type === "cta" ? clean(textOfHtml(str(b.btn_text))) || name : name;
      if (flag(block.hidden) || (flag(b.hide_on_desktop) && flag(b.hide_on_mobile))) {
        hiddenCount++;
        const link = type === "cta" ? resolveLink(b.btn_action, options.siteUrl) || clean(str(b.btn_action)) : "";
        notes.push({ kind: "hidden", text: `Hidden in Kajabi, not imported: ${type === "cta" ? `button "${label}"${link ? ` (${link})` : ""}` : `${name} (${type})`}.` });
        continue;
      }
      liveNotes(ctx, b, label);
      const width = num(b.width);
      const before = inner.length;

      if (type === "text") {
        const split = splitTextButtons(str(b.text));
        inner.push(...textBlocks(split.html, alignOf(b.text_align), id));
        if (split.media > 0) notes.push({ kind: "left_out", text: `The text block "${name}" has ${split.media === 1 ? "a picture or embed" : `${split.media} pictures or embeds`} inside it, which rich text here can't hold; add ${split.media === 1 ? "it" : "them"} as ${split.media === 1 ? "a Picture or Video block" : "Picture or Video blocks"} if you want ${split.media === 1 ? "it" : "them"}.` });
        const made = mapTextButtons(ctx, b, name, split.anchors);
        inner.push(...made);
        textButtons += made.length;
      } else if (type === "image") {
        const ref = pictures.add(b.image);
        if (!ref) {
          notes.push({ kind: "left_out", text: `The picture block "${name}" has no picture.` });
          continue;
        }
        const alt = clean(str(b.image_alt));
        if (!alt) notes.push({ kind: "todo", text: `A picture has no description: add one in the editor (or mark it decorative) before publishing.` });
        if (str(b.img_action)) notes.push({ kind: "left_out", text: `A picture that links somewhere in Kajabi is a plain picture here.` });
        // A narrow picture with a text block of the rest of the row right after it (a testimonial: the face, then the words) is one Split: the picture beside its words.
        const nextKey = blockOrder[index + 1];
        const next = nextKey && !consumed.has(nextKey) ? blocks[nextKey] : undefined;
        const nb = next ? settingsOf(next) : null;
        const nextWidth = nb ? num(nb.width) : null;
        if (next && nb && str(next.type) === "text" && !isHiddenBlock(next) && rgb(nb.background_color) === null && width !== null && width <= 5 && nextWidth !== null && nextWidth <= 8 && width + nextWidth <= 12) {
          consumed.add(nextKey);
          const nextName = clean(str(next.name)) || "text";
          liveNotes(ctx, nb, nextName);
          const parts = splitTextButtons(str(nb.text));
          if (parts.media > 0) notes.push({ kind: "left_out", text: `The text block "${nextName}" has ${parts.media === 1 ? "a picture or embed" : `${parts.media} pictures or embeds`} inside it, which rich text here can't hold; add ${parts.media === 1 ? "it" : "them"} as ${parts.media === 1 ? "a Picture or Video block" : "Picture or Video blocks"} if you want ${parts.media === 1 ? "it" : "them"}.` });
          inner.push({ type: "Split", props: { id: id("Split"), imageAssetId: ref, alt, decorative: false, imageSide: "left", html: sanitizeRichText(parts.html).replace(/<p>\s*<\/p>/g, "") } });
          const made = mapTextButtons(ctx, nb, nextName, parts.anchors);
          inner.push(...made);
          textButtons += made.length;
          words.push(str(nb.text));
          blockCount += inner.length - before;
          widths.push(width + nextWidth);
          continue;
        }
        inner.push({ type: "Image", props: { id: id("Image"), imageAssetId: ref, alt, decorative: false, size: width !== null && width <= 3 ? "small" : width !== null && width <= 8 ? "medium" : "full", rounded: false, align: "center" } });
      } else if (type === "cta") {
        inner.push(makeButton(ctx, b, label));
      } else if (type === "feature") {
        inner.push(...mapFeature(ctx, b, name));
      } else if (type === "card" || type === "pricing") {
        // Cards (and pricing columns) that follow one another sit in one row in Kajabi: one Card grid here.
        const group = sameKind(blockOrder, blocks, index, type);
        for (const k of group.slice(1)) {
          consumed.add(k);
          liveNotes(ctx, settingsOf(blocks[k]), clean(str(blocks[k].name)) || type);
        }
        inner.push(...(type === "card" ? mapCards(ctx, group.map((k) => settingsOf(blocks[k]))) : mapPricing(ctx, group.map((k) => settingsOf(blocks[k])))));
      } else if (type === "accordion") {
        const group = sameKind(blockOrder, blocks, index, type);
        for (const k of group.slice(1)) {
          consumed.add(k);
          liveNotes(ctx, settingsOf(blocks[k]), clean(str(blocks[k].name)) || type);
        }
        inner.push(mapAccordion(ctx, group.map((k) => settingsOf(blocks[k]))));
      } else if (type === "countdown") {
        inner.push(mapCountdown(ctx, b, name, { sectionKey: sectionId, blockKey: key }));
      } else if (type === "video") {
        inner.push(mapVideo(ctx, b));
      } else if (type === "link_list") {
        notes.push({ kind: "todo", text: `Link list "${name}": the export names the Kajabi menu${clean(str(b.menu)) ? ` (${clean(str(b.menu))})` : ""}, not its links. Add the links to this Link list in the editor.` });
        inner.push({ type: "LinkList", props: { id: id("LinkList"), items: [] } });
      } else if (type === "social_icons") {
        const row = mapSocialIcons(ctx, b);
        if (!row) {
          notes.push({ kind: "left_out", text: `"${name}" (social icons) has no links to import.` });
          continue;
        }
        inner.push(row);
      } else if (type === "code") {
        const code = str(b.code);
        const unsafe = unsafeCodeReason(code);
        if (unsafe) {
          leftOutCode.count++;
          for (const host of codeHosts(code)) leftOutCode.hosts.add(host);
          continue;
        }
        const made = textBlocks(code, alignOf(b.text_align), id);
        if (made.length === 0) {
          notes.push({ kind: "left_out", text: `The embedded code block "${name}" has nothing to show.` });
          continue;
        }
        notes.push({ kind: "approximated", text: `The embedded code block "${name}" was plain HTML; it is now text here (styles, scripts and embeds are never carried over).` });
        inner.push(...made);
      } else if (type === "offer") {
        // The export names the offer by its Kajabi id; its title, price and checkout address are looked up when the page runs.
        const cta = clean(textOfHtml(str(b.btn_text)));
        notes.push({ kind: "todo", text: `Offer block "${name}": the export names the Kajabi offer${clean(str(b.offer)) ? ` (${clean(str(b.offer))})` : ""}, not its title, price or checkout link${cta ? `, and its button says "${cta}"` : ""}. Add a card with a button in the editor.` });
        continue;
      } else if (type === "blog") {
        notes.push({ kind: "left_out", text: `The blog block "${name}" is not imported: the blog stays on Kajabi.` });
        continue;
      } else if (type === "form") {
        inner.push(...textBlocks(str(b.text), alignOf(b.text_align), id));
        const formId = clean(str(b.form));
        // The export's form id is the id of the owner's own Kajabi form (the one its public page posts to), which is what the sign-up form's relay submits to.
        const usable = /^\d{1,20}$/.test(formId);
        if (usable) notes.push({ kind: "approximated", text: `The sign-up form is connected to the Kajabi form the export names (${formId}; the export doesn't carry its name): check in the editor that it is the form you want.` });
        else notes.push({ kind: "todo", text: `Choose the Kajabi form for the sign-up form${formId ? ` (the export names form ${formId}, not its name)` : ""} in the editor; until then it isn't shown to visitors.` });
        notes.push({ kind: "todo", text: "The export doesn't list the form's fields. The sign-up form asks for name and email; turn on the Instagram handle in the editor if the Kajabi form asks for it." });
        const thanks = resolveLink(b.thank_you, options.siteUrl);
        inner.push({
          type: "OptInForm",
          props: { id: id("OptInForm"), ...BLOCK_DEFAULTS.OptInForm, kajabiFormId: usable ? formId : "", buttonLabel: clean(str(b.btn_text)) || BLOCK_DEFAULTS.OptInForm.buttonLabel, reassurance: clean(str(b.disclaimer_text)), href: thanks },
        });
      } else {
        notes.push({ kind: "left_out", text: `"${name}" (${type || "unknown"} block) is not imported: it has no counterpart here yet.` });
        continue;
      }
      blockCount += inner.length - before;
      // The width of a card or pricing column is its share of a row, which the grid takes care of.
      if (width !== null && type !== "card" && type !== "pricing") widths.push(width);
      const filled = (type === "text" || type === "form") && rgb(b.background_color) !== null;
      if (filled && wholeCard) {
        boxed = true;
        cardFill ||= b.background_color;
      } else if (filled) {
        // Only this block has a fill: it becomes a card of its own, as wide as the block, with its own text colour.
        const made = inner.splice(before);
        const own = sectionTextTone([str(b.text)]);
        if (own.others.length > 0) notes.push({ kind: "approximated", text: `Coloured text (${own.others.join(", ")}) follows the Hub's text colours here; only plum is kept.` });
        inner.push({
          type: "Section",
          props: { ...BLOCK_DEFAULTS.Section, id: id("Section"), background: "none", overlay: "none", width: width !== null && width <= 7 ? "narrow" : width !== null && width <= 9 ? "medium" : "wide", ...zeroVertical(), align: alignOf(b.text_align) === "center" ? "center" : "left", place: "center", card: true, ...cardStyle(notes, b.background_color), textTone: own.tone, content: made },
        });
      }
      if (!filled || wholeCard) {
        if (type === "text" || type === "form" || type === "feature" || type === "cta") words.push(str(b.text));
      }
    }

    if (inner.length === 0) {
      notes.push({ kind: "left_out", text: `Section ${sectionId} had nothing that could be imported; it is not in the page.` });
      continue;
    }

    // The column: the most common block width (Kajabi sets it per block in twelfths), as the nearest of our widths.
    const counts = new Map<number, number>();
    for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 12;
    // A background video has a still (its poster) in `bg_image`: that is the picture here, and the video is not imported.
    const bgIsVideo = str(s.bg_type).includes("video");
    const bgPicture = str(s.bg_type).includes("image") || (bgIsVideo && str(s.bg_image)) ? pictures.add(s.bg_image) : null;
    if (str(s.bg_video) || bgIsVideo) {
      notes.push({ kind: "left_out", text: bgPicture ? "A section background video is not imported; its still picture is the section's background picture here." : "A section background video is not imported, and it has no still picture: the section has a plain background." });
    }
    const bgPosition = str(s.bg_position) === "top" ? "top" : str(s.bg_position) === "bottom" ? "bottom" : "center";
    const bgFixed = bgPicture !== null && flag(s.background_fixed);
    if (bgFixed) notes.push({ kind: "approximated", text: "The section's picture stays still while the page scrolls (as in Kajabi) on a computer; on a phone it scrolls with the section." });
    const bgColor = rgb(s.background_color);
    const tint = bgColor ? { color: bgColor, alpha: alphaOf(s.background_color) } : null;
    // Over a picture, the section's colour is a tint on it (a light one with a low opacity washes the picture out); without one it is the background.
    let overlay: "none" | "dark" | "light" | "cream" = "none";
    if (bgPicture) {
      // A very faint tint (a quarter strength or less) leaves the picture as it is.
      if (tint && lightness(tint.color) >= 0.6 && tint.alpha < 0.25) overlay = "none";
      else if (tint && lightness(tint.color) >= 0.6) overlay = tint.alpha >= 0.6 ? "light" : "cream";
      else overlay = "dark";
      notes.push({
        kind: "approximated",
        text: tint
          ? `The section's picture has a ${lightness(tint.color) >= 0.6 ? "light" : "dark"} tint in Kajabi (${str(s.background_color)}); it is ${overlay === "none" ? "left without a shade" : `a ${overlay === "dark" ? "dark" : overlay === "light" ? "light" : "soft cream"} shade`} here, which is the nearest we offer (the exact colour and strength are not carried over).`
          : "A dark shade was added over the section's background picture so the text stays readable.",
      });
    }
    const bgPick = bgColor && !bgPicture ? nearest(bgColor, SECTION_COLORS) : { key: "white" as const, exact: true };
    if (bgColor && !bgPicture && !bgPick.exact) notes.push({ kind: "approximated", text: `Section background ${str(s.background_color)} is shown as the nearest of our colours.` });
    const padding = ((num(isObject(s.padding_desktop) ? s.padding_desktop.top : 0) ?? 0) + (num(isObject(s.padding_desktop) ? s.padding_desktop.bottom : 0) ?? 0)) / 2;

    // The card: the block's own fill, as the nearest theme colour; a fill with some transparency lets the picture show faintly through.
    const { cardColor, cardSoft } = boxed ? cardStyle(notes, cardFill) : { cardColor: "default", cardSoft: false };
    // Text colour: plum is kept where most of the words are plum; the other colours follow the theme.
    const { tone, others } = sectionTextTone(words);
    if (others.length > 0) notes.push({ kind: "approximated", text: `Coloured text (${others.join(", ")}) follows the Hub's text colours here; only plum is kept.` });
    const place = str(s.horizontal) === "left" ? "left" : str(s.horizontal) === "right" ? "right" : "center";
    const alignCount = new Map<string, number>();
    for (const k of blockOrder) {
      const align = str(settingsOf(blocks[k]).text_align);
      if (align) alignCount.set(align, (alignCount.get(align) ?? 0) + 1);
    }
    const textAlign = [...alignCount.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] === "center" ? "center" : "left";
    // Kajabi's "full width" lets the blocks spread; a block of half the row is still half the page, so only a section of wide blocks is full width.
    const sectionWidth = flag(s.full_width) && common >= 11 ? "full" : common <= 6 || (boxed && common === 7) ? "narrow" : common <= 9 ? "medium" : "wide";
    const spacing = presetPadding(padding >= 60 ? "large" : "medium");
    // The section's own space above and below, as Kajabi has it (the preset is only for a side that is blank).
    const own = (name: "padding_desktop" | "padding_mobile", side: "top" | "bottom") => (isObject(s[name]) ? num((s[name] as Record<string, unknown>)[side]) : null);
    const space = {
      paddingDesktop: { ...spacing.paddingDesktop, top: own("padding_desktop", "top") ?? spacing.paddingDesktop.top, bottom: own("padding_desktop", "bottom") ?? spacing.paddingDesktop.bottom },
      paddingMobile: { ...spacing.paddingMobile, top: own("padding_mobile", "top") ?? spacing.paddingMobile.top, bottom: own("padding_mobile", "bottom") ?? spacing.paddingMobile.bottom },
    };
    const picture = { backgroundPosition: bgPosition, backgroundFixed: bgFixed };

    // A white logo over a pale band is invisible: it gets a band of its own in plum (Kajabi's other logo is not in the export).
    const lightBehind = bgPicture ? overlay !== "dark" : !["plum", "brownMid", "brown", "charcoal"].includes(bgPick.key);
    const logoHere = headerLogo !== null && (logoOutside || inner[0] === headerLogo);
    let logoBand: Puck | null = null;
    if (headerLogo && logoHere && headerLogoWhite && lightBehind) {
      if (inner[0] === headerLogo) inner.shift();
      logoBand = { type: "Section", props: { ...BLOCK_DEFAULTS.Section, id: id("Section"), background: "plum", width: "wide", ...presetPadding("small"), align: "center", content: [headerLogo] } };
      notes.push({ kind: "approximated", text: "The logo is the white version, which can't be seen on this pale picture: it sits on a plum band above the section. Swap in the dark logo in the editor if you would rather have it on the picture." });
    }
    const logoInBand = logoOutside && !logoBand;

    // A card in the left of the page is a Section of its own, as many of the columns as Kajabi's block takes (with a little extra for the wider page there), so its width and place follow Kajabi's.
    const leftCard = boxed && place === "left" && common >= 4 && common <= 11;
    if ((logoInBand && headerLogo) || leftCard) {
      // The picture and its shade are the band; the logo sits on it, and the card is a Section of its own inside, so the logo is not in the card.
      if (logoInBand && headerLogo) headerLogo.props.align = place === "center" ? "center" : (headerLogo.props.align as string);
      const sideless = { left: 0, right: 0 };
      const inside: Puck = {
        type: "Section",
        props: {
          ...BLOCK_DEFAULTS.Section,
          id: id("Section"),
          background: "none",
          overlay: "none",
          width: leftCard ? "wide" : sectionWidth,
          paddingDesktop: { ...space.paddingDesktop, ...sideless, top: logoInBand ? space.paddingDesktop.top : 0, bottom: 0 },
          paddingMobile: { ...space.paddingMobile, ...sideless, top: logoInBand ? space.paddingMobile.top : 0, bottom: 0 },
          align: textAlign,
          place: leftCard ? "center" : place,
          card: boxed,
          cardColor,
          cardSoft,
          textTone: tone,
          ...(leftCard ? { span: Math.min(12, Math.round(common * 1.15)), spanMobile: 12 } : {}),
          content: inner,
        },
      };
      if (logoBand) content.push(logoBand);
      content.push({
        type: "Section",
        props: {
          ...BLOCK_DEFAULTS.Section,
          id: id("Section"),
          background: bgPick.key,
          backgroundImageAssetId: bgPicture ?? undefined,
          ...picture,
          overlay,
          width: "wide",
          paddingDesktop: { ...space.paddingDesktop, top: logoInBand ? 24 : space.paddingDesktop.top },
          paddingMobile: { ...space.paddingMobile, top: logoInBand ? 16 : space.paddingMobile.top },
          align: "center",
          content: logoInBand && headerLogo ? [headerLogo, inside] : [inside],
        },
      });
      continue;
    }
    if (logoBand) content.push(logoBand);
    content.push({
      type: "Section",
      props: {
        ...BLOCK_DEFAULTS.Section,
        id: id("Section"),
        background: bgPick.key,
        backgroundImageAssetId: bgPicture ?? undefined,
        ...picture,
        overlay,
        width: sectionWidth,
        ...space,
        align: textAlign,
        place,
        card: boxed,
        cardColor,
        cardSoft,
        textTone: tone,
        content: inner,
      },
    });
  }

  if (textButtons > 0) notes.push({ kind: "approximated", text: `${textButtons} button${textButtons === 1 ? "" : "s"} inside text blocks ${textButtons === 1 ? "is" : "are"} now ${textButtons === 1 ? "a Button block" : "Button blocks"} right after ${textButtons === 1 ? "its" : "their"} text.` });
  if (ctx.moved.pages.size > 0) {
    const where = [...ctx.moved.pages.entries()].map(([path, n]) => `${path}${n > 1 ? ` (${n} links)` : ""}`).join(", ");
    notes.push({ kind: "approximated", text: `Links to other Kajabi pages now go to the address Kajabi sends them to: ${where}. Once the root domain serves the Hub these open the Hub's page at that address, or the Kajabi page on the courses site if there is none; before that they only work on the Kajabi site itself.` });
  }
  if (ctx.moved.knownOffers > 0) notes.push({ kind: "approximated", text: `Offer links: ${ctx.moved.knownOffers} now go to the offer's checkout page, as the Hub already knows it (checkout stays in Kajabi).` });
  if (ctx.moved.otherOffers > 0) notes.push({ kind: "approximated", text: `Offer links: ${ctx.moved.otherOffers} go to the offer through the courses site (${ctx.coursesUrl}), where Kajabi stays, because the Hub doesn't know the offer; that address works once the courses site is set up.` });
  if (leftOutCode.count > 0) {
    const hosts = [...leftOutCode.hosts].slice(0, 3).join(", ");
    notes.push({ kind: "left_out", text: `${leftOutCode.count} embedded code block${leftOutCode.count === 1 ? "" : "s"} ${leftOutCode.count === 1 ? "runs" : "run"} a script or load${leftOutCode.count === 1 ? "s" : ""} another site${hosts ? ` (${hosts})` : ""}, which the Hub never allows on a page. Add what they showed (products, buttons) with our blocks.` });
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
      } else {
        const why = b.type === "link_list" ? ": the export names the Kajabi menu, not its links" : b.type === "social_icons" ? ": the footer here shows only the copyright line" : "";
        notes.push({ kind: "left_out", text: `Footer block "${clean(str(b.name)) || str(b.type)}" (${str(b.type)}) is not imported${why}.` });
      }
    }
  }
  notes.push({ kind: "approximated", text: "Fonts and exact spacing follow the Hub's theme, not Kajabi's." });

  const data = sanitizeLandingData({ content, root: { props: root } });
  const layout = layoutFingerprint(order, sections);
  const start = pageStart(data);
  return { ok: true, data, layout, importKey: layoutKeyOf(layout), start, suggestedTitle: suggestTitle(start), pictures: pictures.list, notes, counts: { blocks: blockCount, hidden: hiddenCount }, references: { landingPageIds: [...ctx.refs.landingPageIds], offerCodes: [...ctx.refs.offerCodes], countdowns: ctx.refs.countdowns }, logoBlockId: headerLogo ? String(headerLogo.props.id) : null };
}

/**
 * A fingerprint of the page's layout: the ordered sections of the page (id and kind) and each one's ordered blocks
 * (id and kind). Not the text, the settings, the header or the footer (those belong to the whole site).
 */
function layoutFingerprint(order: string[], sections: Record<string, Section>): string {
  const layout = order.map((sectionId) => {
    const section = sections[sectionId];
    if (!section || !isObject(section) || !isObject(section.blocks)) return [sectionId, "missing", []];
    const blocks = section.blocks;
    const keys = (Array.isArray(section.block_order) ? section.block_order : Object.keys(blocks)).filter((k): k is string => typeof k === "string" && k in blocks);
    return [sectionId, str(section.type), keys.map((k) => [k, str(blocks[k]?.type)])];
  });
  return createHash("sha256").update(JSON.stringify(layout)).digest("hex").slice(0, 32);
}

const LINE_MAX = 140;
const shorten = (text: string) => (text.length > LINE_MAX ? `${text.slice(0, LINE_MAX - 1).trimEnd()}…` : text);

/** The first heading and the first three lines of text of a page's document, in reading order (the blocks inside sections included). */
export function pageStart(data: LandingData): PageStart {
  let heading = "";
  const lines: string[] = [];
  const walk = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!isObject(block) || !isObject(block.props)) continue;
      if (block.type === "Heading" && !heading) heading = clean(str(block.props.text));
      else if (block.type === "RichText" && lines.length < 3) {
        for (const node of parseFragment(str(block.props.html)).childNodes as unknown as Node5[]) {
          const line = clean(textOf(node));
          if (line && lines.length < 3) lines.push(shorten(line));
        }
      }
      for (const value of Object.values(block.props)) walk(value);
    }
  };
  walk(data.content);
  return { heading: shorten(heading), lines };
}

/** A starting point for the title the export lacks: its first heading (or first line), in capitals-for-words case if it was shouted. */
export function suggestTitle(start: PageStart): string {
  const base = clean(start.heading || start.lines[0] || "");
  const calm = base === base.toUpperCase() && /[A-Z]/.test(base) ? base.toLowerCase().replace(/(^|\s)(\S)/g, (_, space: string, c: string) => space + c.toUpperCase()) : base;
  return calm.slice(0, 120).trim();
}

/** The text of a snippet of HTML (a button label with a `<br>`), whitespace as single spaces. */
function textOfHtml(html: string): string {
  return clean(textOf({ nodeName: "#document-fragment", childNodes: parseFragment(html.replace(/&nbsp;/g, " ")).childNodes as unknown as Node5[] }));
}
