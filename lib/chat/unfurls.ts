import { decodeEntities, isSafeHref } from "@/lib/chat/render";
import { parseSharedMessage, type SharedMessage, type SharedMessageSource } from "@/lib/chat/shared-message";

/**
 * What Slack hands us besides a message's text, drawn under it as cards (components/chat/MessageUnfurls.tsx):
 *  - legacy `attachments`: the preview Slack makes of a pasted link (title, text, picture, site) and what apps post with
 *    a colored bar and fields;
 *  - Block Kit `blocks` of a message an app posted (a deploy notice, a calendar bot), a small subset: header, section,
 *    context, divider, image and link buttons. Anything else becomes one "Open in Slack" link.
 *
 * Both come from jsonb written from Slack's payloads, so everything here is read defensively: unknown shapes are
 * dropped, every address must be http(s) (images https), text is capped, and the lists are short. Slack text stays in
 * Slack's escapes (the component renders it with the chat's own mrkdwn renderer, which decodes `&amp;` and resolves
 * mentions); plain fields are decoded here.
 */

export interface UnfurlField {
  title: string;
  value: string;
  short: boolean;
}

/** A legacy attachment: the preview of a link, or an app's card. */
export interface CardUnfurl {
  kind: "card";
  /** A validated `#rrggbb` for the bar down the side, or null. */
  color: string | null;
  authorName: string | null;
  authorLink: string | null;
  /** Slack text above the card (mrkdwn). */
  pretext: string | null;
  title: string | null;
  titleLink: string | null;
  /** mrkdwn, unless `hubPreview`. */
  text: string | null;
  /** A link preview the Hub made itself (lib/chat/link-previews.ts), not Slack's: `text` is plain text, shown as it is (a page's description has no Slack formatting). */
  hubPreview?: boolean;
  /** What removes this card from its message (`unfurlKey`, lib/chat/link-previews.ts); set by the loader on every card. */
  removeKey?: string;
  fields: UnfurlField[];
  imageUrl: string | null;
  thumbUrl: string | null;
  serviceName: string | null;
  /** The site the preview is of, as an http(s) address. */
  fromUrl: string | null;
  /** Slack's `original_url`: the link as it was written in the message (only when Slack gave one); used to match a Hub preview of the same link. */
  originalUrl?: string;
  footer: string | null;
}

/**
 * A shared message (`is_msg_unfurl` / `is_share`), a quoted message. The attachment is passed through untouched; the loader
 * parses it (lib/chat/shared-message.ts) and looks the original up as the viewer, filling `shared` and `source`.
 * MessageUnfurls draws nothing for a share without them (components/chat/SharedMessageCard.tsx draws it).
 */
export interface ShareUnfurl {
  kind: "share";
  attachment: Record<string, unknown>;
  shared?: SharedMessage;
  source?: SharedMessageSource;
}

/** Text of a block: Slack mrkdwn, or plain text that is shown as it is. */
export interface BlockText {
  text: string;
  mrkdwn: boolean;
}

export interface LinkButton {
  label: string;
  url: string;
}

export interface BlockImage {
  url: string;
  alt: string;
}

export type ContextItem = { kind: "text"; text: BlockText } | { kind: "image"; image: BlockImage };

/** One Block Kit block we can draw. Add a type here, to `BLOCK_PARSERS` below and to BLOCK_RENDERERS in the component. */
export type UnfurlBlock =
  | { type: "header"; text: string }
  | { type: "section"; text: BlockText | null; fields: BlockText[]; image: BlockImage | null; button: LinkButton | null }
  | { type: "context"; items: ContextItem[] }
  | { type: "divider" }
  | { type: "image"; image: BlockImage; title: string | null }
  | { type: "actions"; buttons: LinkButton[] }
  /** A block type we don't draw (yet): the card offers "Open in Slack" instead. */
  | { type: "unsupported"; blockType: string };

export interface BlocksUnfurl {
  kind: "blocks";
  blocks: UnfurlBlock[];
}

export type Unfurl = CardUnfurl | ShareUnfurl | BlocksUnfurl;

export interface ParsedUnfurls {
  unfurls: Unfurl[];
  /** The blocks are the message (an app's), so its text, which only repeats them as a fallback, is not shown. */
  hideBody: boolean;
}

export const MAX_ATTACHMENTS = 5;
export const MAX_BLOCKS = 30;
const MAX_FIELDS = 10;
const MAX_URL = 2000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A non-empty string, cut to `max`, or null. */
function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

const CONTROL_OR_SPACE = /[\u0000- \u007f-\u009f]/;

/** An address a link may go to: http(s) only, no whitespace or control characters, parseable. */
export function safeLinkUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX_URL || CONTROL_OR_SPACE.test(v) || !isSafeHref(v) || /^mailto:/i.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** An address a picture may load from: https only (the page is https, so http would be blocked or mixed). */
export function safeImageUrl(v: unknown): string | null {
  const url = safeLinkUrl(v);
  return url && url.startsWith("https://") ? url : null;
}

const NAMED_COLORS: Record<string, string> = { good: "#2eb67d", warning: "#ecb22e", danger: "#e01e5a" };

function colorOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const named = NAMED_COLORS[v.toLowerCase()];
  if (named) return named;
  const hex = /^#?([0-9a-f]{6})$/i.exec(v.trim());
  return hex ? `#${hex[1].toLowerCase()}` : null;
}

// ---- legacy attachments ----------------------------------------------------------------------------------------

function parseCard(a: Record<string, unknown>): CardUnfurl | null {
  const plain = (v: unknown, max: number) => {
    const s = str(v, max);
    return s ? decodeEntities(s) : null;
  };
  const fields: UnfurlField[] = [];
  if (Array.isArray(a.fields)) {
    for (const f of a.fields.slice(0, MAX_FIELDS)) {
      if (!isObject(f)) continue;
      const title = plain(f.title, 200);
      const value = str(f.value, 1000);
      if (!title && !value) continue;
      fields.push({ title: title ?? "", value: value ?? "", short: f.short === true });
    }
  }
  const card: CardUnfurl = {
    kind: "card",
    color: colorOf(a.color),
    authorName: plain(a.author_name, 200),
    authorLink: safeLinkUrl(a.author_link),
    pretext: str(a.pretext, 3000),
    title: plain(a.title, 300),
    titleLink: safeLinkUrl(a.title_link),
    text: str(a.text, 3000),
    fields,
    imageUrl: safeImageUrl(a.image_url),
    thumbUrl: safeImageUrl(a.thumb_url),
    serviceName: plain(a.service_name, 100),
    fromUrl: safeLinkUrl(a.from_url) ?? safeLinkUrl(a.original_url),
    footer: plain(a.footer, 300),
  };
  const originalUrl = safeLinkUrl(a.original_url);
  if (originalUrl) card.originalUrl = originalUrl;
  // `fallback` is the plain-text stand-in for notifications, not something to draw: with nothing else, there is no card.
  const hasContent = card.title || card.text || card.pretext || card.fields.length > 0 || card.imageUrl || card.thumbUrl || card.footer || card.authorName;
  return hasContent ? card : null;
}

// ---- Block Kit -------------------------------------------------------------------------------------------------

/** A Block Kit text object (`plain_text` or `mrkdwn`). */
function textObject(v: unknown, max = 3000): BlockText | null {
  if (!isObject(v)) return null;
  const text = str(v.text, max);
  if (!text) return null;
  if (v.type === "mrkdwn") return { text, mrkdwn: true };
  if (v.type === "plain_text") return { text, mrkdwn: false };
  return null;
}

function imageOf(url: unknown, alt: unknown): BlockImage | null {
  const safe = safeImageUrl(url);
  return safe ? { url: safe, alt: str(alt, 200) ?? "" } : null;
}

/** A `button` element with an address: the only interactive thing drawn, as a plain link (nothing is sent back to Slack). */
function linkButton(v: unknown): LinkButton | null {
  if (!isObject(v) || v.type !== "button") return null;
  const url = safeLinkUrl(v.url);
  const label = textObject(v.text, 75);
  return url && label ? { label: label.text, url } : null;
}

type BlockParser = (b: Record<string, unknown>) => UnfurlBlock | null;

/** One parser per Block Kit block type. A type missing here is `unsupported`. */
export const BLOCK_PARSERS: Record<string, BlockParser> = {
  header: (b) => {
    const t = textObject(b.text, 150);
    return t ? { type: "header", text: t.text } : null;
  },
  section: (b) => {
    const text = textObject(b.text);
    const fields = Array.isArray(b.fields) ? b.fields.slice(0, MAX_FIELDS).flatMap((f) => textObject(f, 1000) ?? []) : [];
    const accessory = isObject(b.accessory) ? b.accessory : null;
    const image = accessory?.type === "image" ? imageOf(accessory.image_url, accessory.alt_text) : null;
    const button = accessory ? linkButton(accessory) : null;
    return text || fields.length > 0 || image || button ? { type: "section", text, fields, image, button } : null;
  },
  context: (b) => {
    const items: ContextItem[] = [];
    for (const e of Array.isArray(b.elements) ? b.elements.slice(0, 10) : []) {
      if (!isObject(e)) continue;
      if (e.type === "image") {
        const image = imageOf(e.image_url, e.alt_text);
        if (image) items.push({ kind: "image", image });
      } else {
        const text = textObject(e, 500);
        if (text) items.push({ kind: "text", text });
      }
    }
    return items.length > 0 ? { type: "context", items } : null;
  },
  divider: () => ({ type: "divider" }),
  image: (b) => {
    const image = imageOf(b.image_url, b.alt_text);
    return image ? { type: "image", image, title: textObject(b.title, 200)?.text ?? null } : null;
  },
  actions: (b) => {
    const buttons = (Array.isArray(b.elements) ? b.elements.slice(0, 25) : []).flatMap((e) => linkButton(e) ?? []);
    // A row with no link button (a menu, a button that only sends something back to the app) can't work here.
    return buttons.length > 0 ? { type: "actions", buttons: buttons.slice(0, 5) } : { type: "unsupported", blockType: "actions" };
  },
};

function parseBlock(raw: unknown): UnfurlBlock | null {
  if (!isObject(raw) || typeof raw.type !== "string") return null;
  const parser = BLOCK_PARSERS[raw.type];
  if (!parser) return { type: "unsupported", blockType: raw.type.slice(0, 40) };
  return parser(raw);
}

/**
 * When blocks are drawn as cards rather than as the message's text. A person's message always has `rich_text` blocks,
 * which the text already says (lib/chat/rich-blocks.ts), so those never get cards. An app's message is drawn from its
 * blocks when it has no `rich_text` and either was posted by an app or has no text of its own. Otherwise: text only.
 */
export function blocksAreCards(blocks: unknown, opts: { bot: boolean; body: string }): blocks is unknown[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  if (blocks.some((b) => isObject(b) && b.type === "rich_text")) return false;
  return opts.bot || opts.body.trim() === "";
}

/**
 * `unfurls` without Slack's own preview of the lesson a message already shows as a video card: a message sharing a lesson that was left as a
 * plain link in Slack (it has files, so it was not rewritten) would otherwise show the card and Slack's picture of the same page.
 */
export function withoutLessonPreview(unfurls: Unfurl[], lessonId: string | undefined): Unfurl[] {
  if (!lessonId) return unfurls;
  const marker = `/lessons/${lessonId}`;
  return unfurls.filter((u) => !(u.kind === "card" && [u.titleLink, u.fromUrl].some((link) => link?.includes(marker))));
}

/** Everything under a message that is not its text. */
export function parseUnfurls(raw: { attachments?: unknown; blocks?: unknown }, opts: { bot: boolean; body: string }): ParsedUnfurls {
  const unfurls: Unfurl[] = [];
  let hideBody = false;

  if (Array.isArray(raw.attachments)) {
    for (const a of raw.attachments.slice(0, MAX_ATTACHMENTS)) {
      if (!isObject(a)) continue;
      if (a.is_msg_unfurl || a.is_share) {
        unfurls.push({ kind: "share", attachment: a });
        continue;
      }
      const card = parseCard(a);
      if (card) unfurls.push(card);
    }
  }

  if (blocksAreCards(raw.blocks, opts)) {
    const blocks = raw.blocks.slice(0, MAX_BLOCKS).flatMap((b) => parseBlock(b) ?? []);
    // One "Open in Slack" is enough, at the end.
    const drawn = blocks.filter((b) => b.type !== "unsupported");
    const unsupported = blocks.find((b) => b.type === "unsupported");
    if (drawn.length > 0 || unsupported) {
      unfurls.push({ kind: "blocks", blocks: unsupported ? [...drawn, unsupported] : drawn });
      // With nothing we could draw, the text stays (it is all there is to read).
      hideBody = drawn.length > 0;
    }
  }
  return { unfurls, hideBody };
}

/** The Slack mrkdwn in these cards, for the lookups a message's body needs too (mentioned people, channels, emoji). */
export function unfurlTexts(unfurls: Unfurl[]): string[] {
  const out: string[] = [];
  const add = (t: BlockText | string | null | undefined) => {
    if (!t) return;
    if (typeof t === "string") out.push(t);
    else if (t.mrkdwn) out.push(t.text);
  };
  for (const u of unfurls) {
    if (u.kind === "card") {
      add(u.pretext);
      add(u.text);
      u.fields.forEach((f) => add(f.value));
    } else if (u.kind === "share") {
      // Names for the mentions in a quoted message; whether the text is shown is decided apart (sharedMessageSource).
      add(parseSharedMessage(u.attachment)?.text);
    } else if (u.kind === "blocks") {
      for (const b of u.blocks) {
        if (b.type === "section") {
          add(b.text);
          b.fields.forEach(add);
        } else if (b.type === "context") {
          b.items.forEach((i) => i.kind === "text" && add(i.text));
        }
      }
    }
  }
  return out;
}
