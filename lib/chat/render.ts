/**
 * Slack message text ("mrkdwn") -> a small tree the chat renders (components/chat/ChatText.tsx).
 * Pure and framework-free so it can be tested on its own. Handles what people actually type:
 * *bold*, _italic_, ~strike~, `code`, ```code blocks```, > quotes, <https://link|label>,
 * <@U123> mentions, <#C123|name> channel links, <!here> style specials, :emoji: and the
 * &amp; &lt; &gt; escapes, "• " bullet lines and blank-line paragraph gaps. Anything else stays
 * plain text; rich_text blocks come later.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold" | "italic" | "strike" | "underline"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; label: string }
  | { t: "user"; id: string }
  | { t: "channel"; id: string; label: string | null }
  | { t: "special"; v: string; /** What follows the `!` in `<!here>` or `<!subteam^S1|@team>`, for sending it back. */ raw?: string }
  | { t: "emoji"; name: string };

export type Block =
  | { t: "line"; c: Inline[]; gap: boolean }
  /** A list item: `n` is its number in an ordered list (absent for a bullet), `indent` how deep it is nested (0 at the top). */
  | { t: "bullet"; c: Inline[]; indent: number; n?: number }
  | { t: "quote"; c: Inline[] }
  | { t: "code"; v: string };

import { EMOTICONS, EMOTICON_IN_TEXT } from "@/lib/chat/emoticons";
import { unicodeEmoji } from "@/lib/chat/emoji";
import { toneOf, tonedUnicode } from "@/lib/chat/skin-tone";

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Each pattern is tried at every position; the earliest match wins (ties go to the earlier pattern).
// Emphasis needs word boundaries on the outside and no padding spaces inside, as in Slack.
const PATTERNS: { re: RegExp; build: (m: RegExpExecArray) => Inline }[] = [
  // Underline is our own marker (Slack's mrkdwn has none; a message with one is sent as rich-text blocks), before the <...> rule.
  { re: /<u>([^\n]+?)<\/u>/, build: (m) => ({ t: "underline", c: parseInline(m[1]) }) },
  { re: /<([^<>]+)>/, build: (m) => angle(m[1]) },
  { re: /`([^`\n]+)`/, build: (m) => ({ t: "code", v: decodeEntities(m[1]) }) },
  { re: /(?<!\w):([a-z0-9_+-]+)(?:::skin-tone-\d)?:(?!\w)/i, build: (m) => ({ t: "emoji", name: m[1].toLowerCase() }) },
  { re: EMOTICON_IN_TEXT, build: (m) => ({ t: "text", v: EMOTICONS[m[1]] }) },
  { re: /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/, build: (m) => ({ t: "bold", c: parseInline(m[1]) }) },
  { re: /(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/, build: (m) => ({ t: "italic", c: parseInline(m[1]) }) },
  { re: /(?<![\w~])~(?!\s)([^~\n]+?)(?<!\s)~(?![\w~])/, build: (m) => ({ t: "strike", c: parseInline(m[1]) }) },
];

/** The inside of a <...> token: a link, mention, channel link or special. */
function angle(body: string): Inline {
  const [target, label] = splitOnce(body, "|");
  if (target.startsWith("@")) return { t: "user", id: target.slice(1) };
  if (target.startsWith("#")) return { t: "channel", id: target.slice(1), label: label ? label : null };
  if (target.startsWith("!")) {
    const word = target.slice(1);
    if (word.startsWith("date")) return { t: "text", v: decodeEntities(label ?? "") };
    if (word.startsWith("subteam")) return { t: "special", v: label ? decodeEntities(label) : "@group", raw: target.slice(1) };
    return { t: "special", v: `@${word}`, raw: word };
  }
  const href = decodeEntities(target);
  if (SAFE_HREF.test(href)) return { t: "link", href, label: decodeEntities(label || target.replace(/^mailto:/i, "")) };
  return { t: "text", v: decodeEntities(`<${body}>`) };
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep);
  return i === -1 ? [s, undefined] : [s.slice(0, i), s.slice(i + sep.length)];
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    let best: { index: number; match: RegExpExecArray; build: (m: RegExpExecArray) => Inline } | null = null;
    for (const { re, build } of PATTERNS) {
      const match = re.exec(rest);
      if (match && (!best || match.index < best.index)) best = { index: match.index, match, build };
    }
    if (!best) break;
    if (best.index > 0) out.push({ t: "text", v: decodeEntities(rest.slice(0, best.index)) });
    out.push(best.build(best.match));
    rest = rest.slice(best.index + best.match[0].length);
  }
  if (rest) out.push({ t: "text", v: decodeEntities(rest) });
  return out;
}

/** A list line: its indent, the number of an ordered item (a `•`, `◦` or `▪` for a bullet) and the text. */
const LIST_ITEM = /^(\s*)(?:[•◦▪]|(\d+)\.)\s+(.*)$/;

const letters = (n: number): string => {
  let out = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(97 + ((k - 1) % 26)) + out;
  return out;
};
const ROMAN_PARTS: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
const roman = (n: number): string => {
  let out = "";
  let rest = n;
  for (const [value, symbol] of ROMAN_PARTS) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
};

/** What stands before a list item, as Slack draws it: `•`, `◦`, `▪` by depth for a bullet; `1.`, `a.`, `i.` by depth for a number. */
export function listMarker(item: { indent: number; n?: number }): string {
  const level = item.indent % 3;
  if (item.n === undefined) return ["•", "◦", "▪"][level];
  return `${[String(item.n), letters(item.n), roman(item.n)][level]}.`;
}

/** A message body as blocks: code fences, quoted lines, list items and ordinary lines. A blank line before a line is kept as its `gap`. */
export function parseSlackText(text: string): Block[] {
  const blocks: Block[] = [];
  let blank = false;
  // The indents of the list items so far in this list, so a nested item is one level deeper than the item it follows
  // however many spaces it is indented by (ours are two, Slack's four).
  const widths: number[] = [];
  const addLines = (raw: string) => {
    for (const [n, line] of raw.split("\n").entries()) {
      if (!line.trim()) {
        // The empty piece before the first newline is just the rest of a fence line, not a blank line.
        blank = blocks.length > 0 && n > 0;
        widths.length = 0;
        continue;
      }
      const item = LIST_ITEM.exec(line);
      if (item) {
        const width = item[1].length;
        while (widths.length && width < widths[widths.length - 1]) widths.pop();
        if (!widths.length || width > widths[widths.length - 1]) widths.push(width);
        blocks.push({ t: "bullet", c: parseInline(item[3]), indent: widths.length - 1, ...(item[2] ? { n: Number(item[2]) } : {}) });
        blank = false;
        continue;
      }
      widths.length = 0;
      // Slack's own text escapes the `>`; a message written in the Hub keeps it raw (and Slack never sends a raw one).
      if (/^(&gt;|>)\s?/.test(line)) blocks.push({ t: "quote", c: parseInline(line.replace(/^(&gt;|>)\s?/, "")) });
      else blocks.push({ t: "line", c: parseInline(line), gap: blank });
      blank = false;
    }
  };

  // Only a closed pair of fences is code; a stray ``` stays text.
  let last = 0;
  for (const fence of text.matchAll(/```([\s\S]*?)```/g)) {
    addLines(text.slice(last, fence.index));
    const code = decodeEntities(fence[1].replace(/^\n/, "").replace(/\n$/, ""));
    if (code) blocks.push({ t: "code", v: code });
    blank = false;
    last = fence.index + fence[0].length;
  }
  addLines(text.slice(last));
  return blocks;
}

/** Slack user ids mentioned in a body, for resolving names in one batch. */
export function mentionedUserIds(text: string): string[] {
  return [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]);
}

/** Slack channel ids linked in a body (<#C123> or <#C123|name>), to look up their names. */
export function mentionedChannelIds(text: string): string[] {
  return [...text.matchAll(/<#([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]);
}

/** Emoji shortcodes used in a body, for looking up the workspace's custom ones in one batch. */
export function emojiNamesIn(text: string): string[] {
  return [...text.matchAll(/(?<!\w):([a-z0-9_+-]+)(?:::skin-tone-\d)?:(?!\w)/gi)].map((m) => m[1].toLowerCase());
}

/** A body as one-line plain text for places that can't render chips (search hit titles): mentions and channel links become names. */
export function mentionsToPlainText(text: string, names: { userNames: Record<string, string>; channelNames: Record<string, string> }): string {
  return text
    .replace(/<\/?u>/g, "")
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id: string, label?: string) => `@${names.userNames[id] ?? label ?? "someone"}`)
    .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id: string, label?: string) => `#${names.channelNames[id] ?? label ?? "channel"}`);
}

/** What the edit box shows for a message's Slack text, and how to turn what is typed back into Slack's. */
export interface EditableText {
  text: string;
  /** What each shown name stands for in Slack's text (`@Ania Ray` -> `<@U123>`). */
  tokens: Map<string, string>;
}

/**
 * Slack's text as the edit box should show it: `<@U123>` as `@Ania Ray`, `<#C1|general>` as `#general`, a labelled
 * link as its label, `<!here>` as `@here`, and `&amp;` `&lt;` `&gt;` as the characters. Anything the box can't say
 * by name stays Slack's own markup. The tokens are what `fromEditableText` needs to put the markup back.
 */
export function toEditableText(
  body: string,
  names: { userNames: Record<string, string>; channelNames: Record<string, string>; customEmoji?: Record<string, unknown> },
  opts: { plain?: boolean } = {}
): EditableText {
  const tokens = new Map<string, string>();
  const shown = (label: string, token: string): string => {
    // Two different things with one name (two people called Sam) get told apart, so each still maps to its own markup.
    const base = decodeEntities(label);
    let name = base;
    for (let n = 2; tokens.has(name) && tokens.get(name) !== token; n++) name = `${base} (${n})`;
    tokens.set(name, token);
    return name;
  };
  // A message written in the Hub is plain text that only carries mention and channel tokens: nothing else is
  // Slack markup, so nothing else is turned into a name or decoded.
  // A standard emoji's :shortcode: is shown as the emoji itself (what picking one writes); a custom one, or code, stays as typed.
  const withEmoji = body.replace(/```[\s\S]*?```|`[^`\n]*`|<[^<>]*>|(?<!\w):([a-z0-9_+-]+)(?:::skin-tone-(\d))?:(?!\w)/gi, (whole, name?: string) => {
    if (!name || name.toLowerCase() in (names.customEmoji ?? {})) return whole;
    const unicode = unicodeEmoji(name);
    if (!unicode) return whole;
    const tone = toneOf(whole.slice(1, -1));
    return tone ? tonedUnicode(unicode, tone) : unicode;
  });
  const text = withEmoji.replace(/<([^<>]+)>/g, (whole, inner: string) => {
    const [target, label] = [inner.split("|")[0], inner.includes("|") ? inner.slice(inner.indexOf("|") + 1) : undefined];
    if (/^@[A-Z0-9]+$/.test(target)) return shown(`@${names.userNames[target.slice(1)] ?? label ?? "someone"}`, whole);
    if (/^#[A-Z0-9]+$/.test(target)) return shown(`#${names.channelNames[target.slice(1)] ?? label ?? "channel"}`, whole);
    if (opts.plain) return whole;
    if (target.startsWith("!")) return shown(label ?? `@${target.slice(1).split("^")[0]}`, whole);
    if (/^(https?:|mailto:)/i.test(target)) return shown(label ?? decodeEntities(target), whole);
    return shown(whole, whole);
  });
  return { text: opts.plain ? text : decodeEntities(text), tokens };
}

/** The reverse of `toEditableText`: escape what was typed for Slack (not for `plain`), then put each shown name back as its markup. */
export function fromEditableText(typed: string, tokens: Map<string, string>, opts: { plain?: boolean } = {}): string {
  const escape = (s: string) => (opts.plain ? s : s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  let out = escape(typed);
  // Longest first, so "@Sam Lee" isn't half-replaced by "@Sam".
  for (const [shown, token] of [...tokens].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(escape(shown)).join(token);
  }
  return out;
}
