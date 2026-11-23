import { createHash } from "node:crypto";
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
};

export type KajabiMapResult =
  | { ok: false; error: string }
  | { ok: true; data: LandingData; layout: string; importKey: string; start: PageStart; suggestedTitle: string; pictures: PictureSource[]; notes: ImportNote[]; counts: { blocks: number; hidden: number } };

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

// ---- blocks beyond text, pictures and forms ------------------------------------------------------------------

type Ctx = { notes: ImportNote[]; pictures: Pictures; id: (type: string) => string; siteUrl: string; themeRadius: number | null };

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

/** A link for a button or a card: usable as is, resolved through the Kajabi site, or empty (and said). */
function checkedLink(ctx: Ctx, label: string, action: unknown, what: string): string {
  const href = resolveLink(action, ctx.siteUrl);
  const raw = clean(str(action));
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
 * Pricing columns become a Card grid as well: the plan's name, the price as written, its heading and the button with the
 * export's link. Nothing is added: no price or link the export does not have. What a card has no room for (the list under the
 * price, a second button) follows the grid, so no words are lost.
 */
function mapPricing(ctx: Ctx, plans: Settings[]): Puck[] {
  const extras: Puck[] = [];
  const items = plans.map((b) => {
    const title = clean(textOfHtml(str(b.name))) || "Plan";
    const ref = flag(b.show_image) ? ctx.pictures.add(b.image) : null;
    if (ref) ctx.notes.push({ kind: "todo", text: NO_DESCRIPTION });
    const label = flag(b.show_cta) ? clean(textOfHtml(str(b.btn_text))) : "";
    const href = label ? checkedLink(ctx, label, b.btn_action, "Pricing button") : "";
    const escaped = title.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    extras.push(...textBlocks(`<h4>${escaped}</h4>${str(b.text)}`, "left", ctx.id));
    const second = flag(b.show_secondary_cta) ? clean(textOfHtml(str(b.secondary_btn_text))) : "";
    if (second) {
      const synthesized: Settings = { btn_text: b.secondary_btn_text, btn_action: b.secondary_btn_action, btn_background_color: b.secondary_btn_background_color, btn_text_color: b.secondary_btn_text_color, btn_style: b.secondary_btn_style, btn_width: b.secondary_btn_width, btn_border_radius: b.secondary_btn_border_radius, text_align: "left" };
      extras.push(makeButton(ctx, synthesized, second));
    }
    return { type: "GridCard", props: { id: ctx.id("GridCard"), imageAssetId: ref ?? undefined, alt: "", icon: "", title, description: clean(textOfHtml(str(b.heading))), price: clean(str(b.price)), buttonLabel: label, href } };
  });
  ctx.notes.push({ kind: "approximated", text: `${items.length} pricing column${items.length === 1 ? "" : "s"} became a Card grid with each price as written and the button's link from the export; nothing was added. The list under each price, and any second button, follow the grid as text and buttons.` });
  return [{ type: "CardGrid", props: { id: ctx.id("CardGrid"), columns: gridColumns(items.length), items } }, ...extras];
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

/** The export names a Kajabi event, not its date, so the countdown has none until it is set in the editor. */
function mapCountdown(ctx: Ctx, b: Settings, name: string): Puck {
  const event = clean(str(b.event));
  ctx.notes.push({ kind: "todo", text: `Countdown "${name}": the export names a Kajabi event${event ? ` (${event})` : ""}, not its date. Set the date in the editor; until then the countdown isn't shown to visitors.` });
  if (flag(b.enable_end_action) || str(b.end_action)) ctx.notes.push({ kind: "left_out", text: `What Kajabi does when the countdown "${name}" ends (${clean(str(b.end_action)) || "an action"}) is not imported; choose what happens in the editor.` });
  return { type: "Countdown", props: { id: ctx.id("Countdown"), ...BLOCK_DEFAULTS.Countdown, targetAt: "", heading: "", whenExpired: flag(b.remove_section_on_complete) ? "hide" : "zeros" } };
}

/** A Kajabi-hosted video is an id in the export, with no address to play it from; the Hub plays YouTube, Vimeo and Mux. */
function mapVideo(ctx: Ctx, b: Settings): Puck {
  const video = clean(str(b.video));
  ctx.notes.push({ kind: "todo", text: `A video${video ? ` (Kajabi video ${video})` : ""} can't be carried over: the export has only its Kajabi id. Paste its YouTube, Vimeo or Mux link into the Video block in the editor.` });
  return { type: "Video", props: { id: ctx.id("Video"), url: "", title: "" } };
}

const SOCIAL_LABELS: Record<string, string> = { facebook: "Facebook", twitter: "Twitter", instagram: "Instagram", youtube: "YouTube", spotify: "Spotify", linkedin: "LinkedIn", pinterest: "Pinterest", tiktok: "TikTok", apple_podcasts: "Apple Podcasts", google_podcasts: "Google Podcasts", itunes: "iTunes", snapchat: "Snapchat", vimeo: "Vimeo", soundcloud: "SoundCloud", github: "GitHub", medium: "Medium", twitch: "Twitch", rss: "RSS" };

/** Social icons become a row of text links (up to three buttons, else a link list): the networks that have an address. */
function mapSocialIcons(ctx: Ctx, b: Settings): Puck | null {
  const links = Object.entries(b)
    .filter(([key]) => key.startsWith("social_icon_link_"))
    .map(([key, value]) => {
      const network = key.slice("social_icon_link_".length);
      return { label: SOCIAL_LABELS[network] ?? network.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), href: resolveLink(value, ctx.siteUrl), given: clean(str(value)) };
    })
    .filter((l) => l.given);
  if (links.length === 0) return null;
  for (const l of links.filter((x) => !x.href)) ctx.notes.push({ kind: "todo", text: `The ${l.label} link in the social icons can't be used here: set it in the editor.` });
  ctx.notes.push({ kind: "approximated", text: `Social icons became ${links.length <= 3 ? "a row of text buttons" : "a list of links"} (${links.map((l) => l.label).join(", ")}): the Hub has no icon block yet.` });
  if (links.length <= 3) {
    return {
      type: "ButtonRow",
      props: { id: ctx.id("ButtonRow"), align: str(b.horizontal) === "center" ? "center" : "left", gap: "medium", items: links.map((l) => ({ type: "RowButton", props: { id: ctx.id("RowButton"), label: l.label, href: l.href, look: "outline", color: "plum", shape: "pill" } })) },
    };
  }
  return { type: "LinkList", props: { id: ctx.id("LinkList"), items: links.map((l) => ({ type: "LinkItem", props: { id: ctx.id("LinkItem"), label: l.label, href: l.href, look: "inherit", color: "plum" } })) } };
}

/** Why embedded code is not carried over, or null when it is plain markup the rich text rules can hold. Anything that runs or loads something is refused. */
function unsafeCodeReason(code: string): string | null {
  if (/<\s*(script|iframe|style|object|embed|form|link|meta|base|svg|math|template|input|button|textarea|frame|applet)\b/i.test(code) || /\son[a-z]+\s*=/i.test(code) || /javascript\s*:/i.test(code)) return "runs a script or loads another site";
  return null;
}
const codeHosts = (code: string) => [...code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());

// ---- the page ------------------------------------------------------------------------------------------------

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
  const ctx: Ctx = { notes, pictures, id, siteUrl: options.siteUrl, themeRadius };
  /** Embedded code that runs a script or loads another site: never imported, said once for the page. */
  const leftOutCode = { count: 0, hosts: new Set<string>() };

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
        inner.push(mapCountdown(ctx, b, name));
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
      // The width of a card or pricing column is its share of a row, which the grid takes care of.
      if (width !== null && type !== "card" && type !== "pricing") widths.push(width);
      if (rgb(b.background_color) && (type === "text" || type === "form")) boxed = true;
    }

    if (inner.length === 0) {
      notes.push({ kind: "left_out", text: `Section ${sectionId} had nothing that could be imported; it is not in the page.` });
      continue;
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
  return { ok: true, data, layout, importKey: layoutKeyOf(layout), start, suggestedTitle: suggestTitle(start), pictures: pictures.list, notes, counts: { blocks: blockCount, hidden: hiddenCount } };
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
