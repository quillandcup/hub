/**
 * A Slack message shared into another message: someone pasted a message permalink, or used "Share message". Slack puts
 * the quoted message in the sharer's `attachments` with `is_share` / `is_msg_unfurl`. This module turns one such
 * attachment into a small typed value and decides what a viewer may see of it. Pure: no database, no React.
 *
 * Privacy (docs/SLACK_BRIDGED_CHAT.md, "Shared messages"): the quoted text is NOT shown because Slack embedded it. It is
 * shown only when the loader re-resolved the source message in the Hub *as the viewer* and found it readable
 * (`sharedMessageSource`). Anything else is a stub that says nothing about the source's text, author or channel name.
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
  /** Slack's embedded copy of the text, still in Slack markup (`&amp;`, `<@U1>`), for ChatText. Never shown unless the source is readable. */
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
  /** The channel as Slack named it; withheld from a viewer who can't read the source. */
  channelName: string | null;
  /** The message's own Slack permalink (https, on slack.com) for "Open in Slack". */
  slackUrl: string | null;
  /** Slack's footer line (often "Posted in #channel"). */
  footer: string | null;
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
  return {
    text,
    authorName: str(att.author_name) ?? str(att.author_subname) ?? "Someone",
    authorSubname: str(att.author_name) ? str(att.author_subname) : null,
    authorIcon: httpsUrl(att.author_icon),
    ts,
    postedAt: slackTsToIso(ts),
    slackChannelId: typeof att.channel_id === "string" && /^[A-Z0-9]{3,20}$/.test(att.channel_id) ? att.channel_id : null,
    channelName: str(att.channel_name, 80),
    slackUrl: slackPermalink(att.from_url),
    footer: str(att.footer),
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
 * `chat_can_read_content` applied). The three answers are kept apart on purpose:
 * - `readable`: the Hub has the message and the viewer may read it.
 * - `hidden`: the Hub has the conversation but the viewer may not read it (private, a DM, restricted): or the lookup failed.
 * - `not_mirrored`: the Hub has no copy (the source conversation isn't bridged, or the message is older than the import).
 */
export type SharedSourceLookup =
  | { state: "readable"; channelId: string; messageId: string; deleted: boolean; text?: string }
  | { state: "hidden" }
  | { state: "not_mirrored" };

/** What the card may show. `text` is only ever set for `readable`. */
export type SharedMessageSource =
  | { kind: "readable"; hubUrl: string; deleted: boolean; text: string }
  | { kind: "private" }
  | { kind: "elsewhere" };

/**
 * Decides what a viewer sees of a share. Fail closed: no lookup (undefined), `hidden` and `not_mirrored` never carry the
 * quoted text. The Hub's current text wins over Slack's embedded copy, which goes stale when the source is edited.
 */
export function sharedMessageSource(shared: SharedMessage, lookup: SharedSourceLookup | undefined): SharedMessageSource {
  if (!lookup || lookup.state === "hidden") return { kind: "private" };
  if (lookup.state === "not_mirrored") return { kind: "elsewhere" };
  if (!/^[A-Za-z0-9_-]+$/.test(lookup.channelId) || !/^[A-Za-z0-9_-]+$/.test(lookup.messageId)) return { kind: "private" };
  return {
    kind: "readable",
    hubUrl: `/chat/${lookup.channelId}?m=${lookup.messageId}`,
    deleted: lookup.deleted,
    text: lookup.deleted ? "" : lookup.text ?? shared.text,
  };
}
