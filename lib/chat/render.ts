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
  | { t: "bold" | "italic" | "strike"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; label: string }
  | { t: "user"; id: string }
  | { t: "channel"; id: string; label: string | null }
  | { t: "special"; v: string }
  | { t: "emoji"; name: string };

export type Block =
  | { t: "line"; c: Inline[]; gap: boolean }
  | { t: "bullet"; c: Inline[] }
  | { t: "quote"; c: Inline[] }
  | { t: "code"; v: string };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Each pattern is tried at every position; the earliest match wins (ties go to the earlier pattern).
// Emphasis needs word boundaries on the outside and no padding spaces inside, as in Slack.
const PATTERNS: { re: RegExp; build: (m: RegExpExecArray) => Inline }[] = [
  { re: /<([^<>]+)>/, build: (m) => angle(m[1]) },
  { re: /`([^`\n]+)`/, build: (m) => ({ t: "code", v: decodeEntities(m[1]) }) },
  { re: /:([a-z0-9_+-]+)(?:::skin-tone-\d)?:/i, build: (m) => ({ t: "emoji", name: m[1].toLowerCase() }) },
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
    if (word.startsWith("subteam")) return { t: "special", v: label ? decodeEntities(label) : "@group" };
    return { t: "special", v: `@${word}` };
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

/** A message body as blocks: code fences, quoted lines, bullets and ordinary lines. A blank line before a line is kept as its `gap`. */
export function parseSlackText(text: string): Block[] {
  const blocks: Block[] = [];
  let blank = false;
  const addLines = (raw: string) => {
    for (const [n, line] of raw.split("\n").entries()) {
      if (!line.trim()) {
        // The empty piece before the first newline is just the rest of a fence line, not a blank line.
        blank = blocks.length > 0 && n > 0;
        continue;
      }
      if (/^&gt;\s?/.test(line)) blocks.push({ t: "quote", c: parseInline(line.replace(/^&gt;\s?/, "")) });
      else if (/^\s*[•◦▪]\s+/.test(line)) blocks.push({ t: "bullet", c: parseInline(line.replace(/^\s*[•◦▪]\s+/, "")) });
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
  return [...text.matchAll(/:([a-z0-9_+-]+)(?:::skin-tone-\d)?:/gi)].map((m) => m[1].toLowerCase());
}

/** A body as one-line plain text for places that can't render chips (search hit titles): mentions and channel links become names. */
export function mentionsToPlainText(text: string, names: { userNames: Record<string, string>; channelNames: Record<string, string> }): string {
  return text
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
export function toEditableText(body: string, names: { userNames: Record<string, string>; channelNames: Record<string, string> }): EditableText {
  const tokens = new Map<string, string>();
  const shown = (label: string, token: string): string => {
    // Two different things with one name (two people called Sam) get told apart, so each still maps to its own markup.
    const base = decodeEntities(label);
    let name = base;
    for (let n = 2; tokens.has(name) && tokens.get(name) !== token; n++) name = `${base} (${n})`;
    tokens.set(name, token);
    return name;
  };
  const text = body.replace(/<([^<>]+)>/g, (whole, inner: string) => {
    const [target, label] = [inner.split("|")[0], inner.includes("|") ? inner.slice(inner.indexOf("|") + 1) : undefined];
    if (/^@[A-Z0-9]+$/.test(target)) return shown(`@${names.userNames[target.slice(1)] ?? label ?? "someone"}`, whole);
    if (/^#[A-Z0-9]+$/.test(target)) return shown(`#${names.channelNames[target.slice(1)] ?? label ?? "channel"}`, whole);
    if (target.startsWith("!")) return shown(label ?? `@${target.slice(1).split("^")[0]}`, whole);
    if (/^(https?:|mailto:)/i.test(target)) return shown(label ?? decodeEntities(target), whole);
    return shown(whole, whole);
  });
  return { text: decodeEntities(text), tokens };
}

/** The reverse of `toEditableText`: escape what was typed for Slack, then put each shown name back as its markup. */
export function fromEditableText(typed: string, tokens: Map<string, string>): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let out = escape(typed);
  // Longest first, so "@Sam Lee" isn't half-replaced by "@Sam".
  for (const [shown, token] of [...tokens].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(escape(shown)).join(token);
  }
  return out;
}
