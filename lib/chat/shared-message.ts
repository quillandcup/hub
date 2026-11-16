/**
 * A Slack message shared into another message: someone pasted a message permalink, or used "Share message". Slack puts
 * the quoted message in the sharer's `attachments` with `is_share` / `is_msg_unfurl`. This module turns one such
 * attachment into a small typed value and decides what a viewer may see of it. Pure: no database, no React.
 *
 * Privacy (docs/SLACK_BRIDGED_CHAT.md, "Shared Slack messages"): the embedded copy is shown to everyone who can read the
 * sharing message, as in Slack: the sharer chose to share it, and the copy sits in the sharer's own content row. Looking
 * the original up in the Hub (`sharedMessageSource`) only adds a link or a note.
 */

/** Share cards drawn per message; the rest are ignored. */
export const MAX_SHARED_MESSAGES = 3;
/** The quoted text is cut here (an attachment is Slack's copy, and is stored whole). */
export const MAX_SHARED_TEXT = 1500;
const MAX_FIELD = 200;
const MAX_FILES = 5;
const MAX_BLOCK_NODES = 200;

export interface SharedMessageFile {
  name: string;
  /** Slack's mimetype, "" when unknown. */
  mimetype: string;
}

export interface SharedMessage {
  /** Slack's embedded copy of the text, still in Slack markup (`&amp;`, `<@U1>`), for ChatText. */
  text: string;
  /** Who wrote it, as Slack named them. */
  authorName: string;
  /** The author's @handle or role line, when Slack sent one. */
  authorSubname: string | null;
  /** https only. */
  authorIcon: string | null;
  /** The quoted message's own time (Slack ts, "1700000000.000100"). */
  ts: string | null;
  /** The quoted message's time as an ISO string. */
  postedAt: string | null;
  /** Slack ids of the source conversation: how the loader finds the Hub copy. */
  slackChannelId: string | null;
  /** The channel's name: Slack's own `channel_name` when the attachment has one (a real share usually has not), else filled by the loader from the Hub's channel list by id. Never the footer ("Slack Conversation"). */
  channelName: string | null;
  /** The message's own Slack permalink (https, on slack.com) for "Open in Slack". */
  slackUrl: string | null;
  files: SharedMessageFile[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, max = MAX_FIELD): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return t ? t.slice(0, max) : null;
}

/** An https address, or null: a `javascript:` or `data:` URL in a hostile attachment never reaches an href or src. */
export function httpsUrl(v: unknown): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Only Slack's own addresses count as "the message in Slack". */
function slackPermalink(v: unknown): string | null {
  const u = httpsUrl(v);
  if (!u) return null;
  const host = new URL(u).hostname.toLowerCase();
  return host === "slack.com" || host.endsWith(".slack.com") ? u : null;
}

/** Text out of Slack's block kit (`message_blocks[].message.blocks`), when the attachment has no plain `text`. Bounded. */
function blocksText(blocks: unknown): string {
  const out: string[] = [];
  let budget = MAX_BLOCK_NODES;
  const walk = (n: unknown, depth: number) => {
    if (budget-- <= 0 || depth > 6) return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c, depth + 1);
      return;
    }
    if (!isObj(n)) return;
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
    else if (n.type === "link" && typeof n.url === "string") out.push(typeof n.text === "string" ? n.text : n.url);
    else if (n.type === "user" && typeof n.user_id === "string") out.push(`<@${n.user_id}>`);
    else if (n.type === "emoji" && typeof n.name === "string") out.push(`:${n.name}:`);
    if (n.type === "rich_text_section" || n.type === "rich_text_quote" || n.type === "rich_text_preformatted" || n.type === "rich_text_list") {
      walk(n.elements, depth + 1);
      out.push("\n");
    } else if (n.type === "rich_text" || n.type === "section") {
      walk(n.elements ?? n.text, depth + 1);
    }
  };
  walk(blocks, 0);
  return out.join("").trim();
}

function quotedText(a: Json): string {
  const direct = typeof a.text === "string" ? a.text : "";
  if (direct.trim()) return direct;
  if (Array.isArray(a.message_blocks)) {
    for (const mb of a.message_blocks.slice(0, 2)) {
      if (isObj(mb) && isObj(mb.message)) {
        const t = blocksText(mb.message.blocks);
        if (t) return t;
      }
    }
  }
  return typeof a.fallback === "string" ? a.fallback : "";
}

const SLACK_ID = /^[A-Z0-9]{3,20}$/;
/** The source channel's Slack id: `channel_id`, else the first `message_blocks[].channel`. */
function channelIdOf(a: Json): string | null {
  if (typeof a.channel_id === "string" && SLACK_ID.test(a.channel_id)) return a.channel_id;
  if (Array.isArray(a.message_blocks)) {
    for (const mb of a.message_blocks.slice(0, 2)) if (isObj(mb) && typeof mb.channel === "string" && SLACK_ID.test(mb.channel)) return mb.channel;
  }
  return null;
}

/**
 * The key that removes this share (`url:<address>`, how the author's removal is stored and what Slack's attachment is matched on
 * when the message was written in the Hub): the link as it was written, else the message's permalink. Null when the attachment
 * carries no usable https address, so such a card has no X.
 */
export function shareRemoveKey(a: unknown): string | null {
  if (!isSharedMessage(a)) return null;
  const att = a as Json;
  for (const candidate of [att.original_url, att.from_url, att.title_link]) {
    const u = httpsUrl(candidate);
    if (u && u.length <= 2000) return `url:${u}`;
  }
  return null;
}

/** Does this attachment quote another Slack message? */
export function isSharedMessage(a: unknown): boolean {
  return isObj(a) && (a.is_share === true || a.is_msg_unfurl === true);
}

function slackTsToIso(ts: string | null): string | null {
  if (!ts || !/^\d{9,11}(\.\d{1,6})?$/.test(ts)) return null;
  const d = new Date(Number(ts) * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * One attachment as a shared message, or null when it isn't one or has nothing to quote. Attachments nested inside the
 * quoted message (a share of a share) are deliberately not read: the card quotes one level, so a chain can't grow the page.
 */
export function parseSharedMessage(a: unknown): SharedMessage | null {
  if (!isSharedMessage(a)) return null;
  const att = a as Json;
  const raw = quotedText(att);
  const files: SharedMessageFile[] = [];
  if (Array.isArray(att.files)) {
    for (const f of att.files.slice(0, MAX_FILES)) {
      if (!isObj(f)) continue;
      const name = str(f.name) ?? str(f.title);
      if (name) files.push({ name, mimetype: str(f.mimetype, 100) ?? "" });
    }
  }
  const text = raw.slice(0, MAX_SHARED_TEXT);
  if (!text.trim() && files.length === 0) return null;
  const ts = str(att.ts, 32);
  const authorName = str(att.author_name) ?? str(att.author_subname) ?? "Someone";
  // Slack often sends the same name as both `author_name` and `author_subname`; the second line only shows when it adds something.
  const subname = str(att.author_name) ? str(att.author_subname) : null;
  const sameWords = (a: string, b: string) => a.replace(/\s+/g, " ").toLowerCase() === b.replace(/\s+/g, " ").toLowerCase();
  return {
    text,
    authorName,
    authorSubname: subname && !sameWords(subname, authorName) ? subname : null,
    authorIcon: httpsUrl(att.author_icon),
    ts,
    postedAt: slackTsToIso(ts),
    slackChannelId: channelIdOf(att),
    channelName: str(att.channel_name, 80),
    slackUrl: slackPermalink(att.from_url),
    files,
  };
}

/** Every share card in a message's attachments, in order, at most `MAX_SHARED_MESSAGES`. Anything that isn't an array yields none. */
export function parseSharedMessages(attachments: unknown): SharedMessage[] {
  if (!Array.isArray(attachments)) return [];
  const out: SharedMessage[] = [];
  for (const a of attachments) {
    const s = parseSharedMessage(a);
    if (s) out.push(s);
    if (out.length >= MAX_SHARED_MESSAGES) break;
  }
  return out;
}


/**
 * What the loader found when it looked the source message up in the Hub *as the viewer* (their row-level security, so
 * `chat_can_read_content` applied). It only ever adds to the card, it never gates it:
 * - `readable`: the Hub has the message and the viewer may read it (or it was deleted).
 * - `hidden`: the Hub has the conversation but the viewer may not read it, or the lookup failed.
 * - `not_mirrored`: the Hub has no copy (the conversation isn't bridged, or the message is older than the import).
 */
export type SharedSourceLookup =
  | { state: "readable"; channelId: string; messageId: string; deleted: boolean }
  | { state: "hidden" }
  | { state: "not_mirrored" };

/** The extras around Slack's embedded copy: a Hub link only when the viewer can open the original, and whether it was deleted. */
export interface SharedMessageSource {
  /** `/chat/<channel>?m=<id>`, or null when the viewer can't open the original in the Hub. */
  hubUrl: string | null;
  /** The original was deleted in the Hub; the card still shows the copy, with a note. */
  deleted: boolean;
}

/**
 * Decides the links around a share. The quoted text is always the embedded copy: whoever may read the sharing message
 * may read the copy inside it (same row, same policy), and the sharer chose to share it. The copy is the message as it was
 * shared, as in Slack, so it is not swapped for the Hub's current text. Fails closed on the link only.
 */
export function sharedMessageSource(lookup: SharedSourceLookup | undefined): SharedMessageSource {
  if (!lookup || lookup.state !== "readable") return { hubUrl: null, deleted: false };
  if (!/^[A-Za-z0-9_-]+$/.test(lookup.channelId) || !/^[A-Za-z0-9_-]+$/.test(lookup.messageId)) return { hubUrl: null, deleted: false };
  return lookup.deleted ? { hubUrl: null, deleted: true } : { hubUrl: `/chat/${lookup.channelId}?m=${lookup.messageId}`, deleted: false };
}
