/**
 * Slack message text ("mrkdwn") -> a small tree the chat renders (components/chat/ChatText.tsx).
 * Pure and framework-free so it can be tested on its own. Handles what people actually type:
 * *bold*, _italic_, ~strike~, `code`, ```code blocks```, > quotes, <https://link|label>,
 * <@U123> mentions, <#C123|name> channel links, <!here> style specials, :emoji: and the
 * &amp; &lt; &gt; escapes. Anything else stays plain text; rich_text blocks come later.
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
  | { t: "line"; c: Inline[] }
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

/** A message body as blocks: code fences, quoted lines and ordinary lines (blank lines dropped). */
export function parseSlackText(text: string): Block[] {
  const blocks: Block[] = [];
  const addLines = (raw: string) => {
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      if (/^&gt;\s?/.test(line)) blocks.push({ t: "quote", c: parseInline(line.replace(/^&gt;\s?/, "")) });
      else blocks.push({ t: "line", c: parseInline(line) });
    }
  };

  // Only a closed pair of fences is code; a stray ``` stays text.
  let last = 0;
  for (const fence of text.matchAll(/```([\s\S]*?)```/g)) {
    addLines(text.slice(last, fence.index));
    const code = decodeEntities(fence[1].replace(/^\n/, "").replace(/\n$/, ""));
    if (code) blocks.push({ t: "code", v: code });
    last = fence.index + fence[0].length;
  }
  addLines(text.slice(last));
  return blocks;
}

/** Slack user ids mentioned in a body, for resolving names in one batch. */
export function mentionedUserIds(text: string): string[] {
  return [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]);
}
