import { isEmojiOnly } from "@/lib/chat/emoji-only";

/**
 * The message box shows styled text (bold, lists, quotes, links, emoji images) but its owners hand text around as
 * Slack mrkdwn, the format a Hub message is stored and sent in: `*bold*`, `_italic_`, `~strike~`, backticks, fences,
 * `> quote`, `• ` and `1. ` lines, `<https://x|label>` links, `:name:` emoji and `<u>underline</u>` (our own marker: Slack's
 * mrkdwn has no underline, so a message that has one is sent as rich-text blocks, lib/chat/rich-blocks.ts). These two functions are the bridge
 * between the editor's document (ProseMirror JSON) and that text. Pure and free of the editor library, so the round
 * trip can be tested on its own.
 */

export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

/** What a custom emoji name draws as (its image, or the character it is an alias for); null if it isn't one. */
export type EmojiLookup = (name: string) => { url: string } | { text: string } | null;

// Outermost first. Code can't hold other marks, and a link's label is plain text, so both sit innermost.
const MARK_ORDER = ["underline", "bold", "italic", "strike", "code", "link"] as const;
const MARKERS: Record<string, [string, string]> = { underline: ["<u>", "</u>"], bold: ["*", "*"], italic: ["_", "_"], strike: ["~", "~"], code: ["`", "`"] };

const hasMark = (n: RichNode, type: string) => n.marks?.some((m) => m.type === type) ?? false;
const markKey = (n: RichNode, type: string) => JSON.stringify(n.marks?.find((m) => m.type === type)?.attrs ?? null);

function leaf(n: RichNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "emoji") return `:${String(n.attrs?.name ?? "")}:`;
  return "";
}

/** Slack ignores emphasis with a space just inside the marker, so the markers hug the words and the spaces stay outside. */
function hug(inner: string, open: string, close: string): string {
  const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return body ? `${lead}${open}${body}${close}${trail}` : inner;
}

function inline(nodes: RichNode[], order: readonly string[]): string {
  if (order.length === 0) return nodes.map(leaf).join("");
  const [mark, ...rest] = order;
  let out = "";
  let i = 0;
  while (i < nodes.length) {
    if (!hasMark(nodes[i], mark)) {
      let j = i;
      while (j < nodes.length && !hasMark(nodes[j], mark)) j++;
      out += inline(nodes.slice(i, j), rest);
      i = j;
      continue;
    }
    // A run of neighbours with the same mark (and, for a link, the same address) is wrapped once.
    const key = markKey(nodes[i], mark);
    let j = i;
    while (j < nodes.length && hasMark(nodes[j], mark) && markKey(nodes[j], mark) === key) j++;
    const run = nodes.slice(i, j).map((n) => ({ ...n, marks: n.marks!.filter((m) => m.type !== mark) }));
    const inner = inline(run, rest);
    if (mark === "link") {
      const href = String(nodes[i].marks!.find((m) => m.type === "link")!.attrs?.href ?? "");
      const label = inner.replace(/[<>|]/g, "").trim();
      const [, lead, , trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
      out += href && label ? `${lead}<${href}${label === href ? "" : `|${label}`}>${trail}` : inner;
    } else if (mark === "underline") out += inner ? `${MARKERS[mark][0]}${inner}${MARKERS[mark][1]}` : inner;
    else out += hug(inner, MARKERS[mark][0], MARKERS[mark][1]);
    i = j;
  }
  return out;
}

function blockLines(n: RichNode): string[] {
  const kids = n.content ?? [];
  switch (n.type) {
    case "paragraph":
      return inline(kids, MARK_ORDER).split("\n");
    case "blockquote":
      return kids.flatMap(blockLines).map((l) => `> ${l}`);
    case "bulletList":
    case "orderedList": {
      const start = n.type === "orderedList" ? Number(n.attrs?.start ?? 1) : 0;
      return kids.flatMap((item, index) => {
        const lines = (item.content ?? []).flatMap(blockLines);
        const prefix = n.type === "bulletList" ? "• " : `${start + index}. `;
        return lines.map((l, k) => (k === 0 ? `${prefix}${l}` : `  ${l}`));
      });
    }
    case "codeBlock":
      return ["```", ...kids.map((k) => k.text ?? "").join("").split("\n"), "```"];
    default:
      return [];
  }
}

/** The editor's document as the text the box's owners keep (and send). */
export function docToMrkdwn(doc: RichNode): string {
  return (doc.content ?? []).flatMap(blockLines).join("\n");
}

// ---- text to document ------------------------------------------------------------------------------------------

const text = (value: string, marks?: RichNode["marks"]): RichNode => ({ type: "text", text: value, ...(marks?.length ? { marks } : {}) });

const withMark = (nodes: RichNode[], type: string): RichNode[] =>
  // Code excludes every other mark, so it keeps to itself.
  nodes.map((n) => (hasMark(n, "code") ? n : { ...n, marks: [...(n.marks ?? []), { type }] }));

type Matcher = (rest: string) => { index: number; length: number; nodes: RichNode[] } | null;

function matchers(lookup?: EmojiLookup): Matcher[] {
  const regex =
    (re: RegExp, build: (m: RegExpExecArray) => RichNode[] | null): Matcher =>
    (rest) => {
      const m = re.exec(rest);
      const nodes = m && build(m);
      return m && nodes ? { index: m.index, length: m[0].length, nodes } : null;
    };
  return [
    regex(/<u>([^\n]+?)<\/u>/, (m) => withMark(parseInline(m[1], lookup), "underline")),
    regex(/`([^`\n]+)`/, (m) => [text(m[1], [{ type: "code" }])]),
    regex(/<((?:https?:\/\/|mailto:)[^\s<>|]+)(?:\|([^<>]*))?>/, (m) => [text(m[2] || m[1].replace(/^mailto:/i, ""), [{ type: "link", attrs: { href: m[1] } }])]),
    regex(/:([a-z0-9_+-]+):/i, (m) => {
      const found = lookup?.(m[1].toLowerCase());
      if (!found) return null;
      const name = m[1].toLowerCase();
      return [{ type: "emoji", attrs: { name, url: "url" in found ? found.url : null, text: "text" in found ? found.text : null } }];
    }),
    regex(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/, (m) => withMark(parseInline(m[1], lookup), "bold")),
    regex(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/, (m) => withMark(parseInline(m[1], lookup), "italic")),
    regex(/(?<![\w~])~(?!\s)([^~\n]+?)(?<!\s)~(?![\w~])/, (m) => withMark(parseInline(m[1], lookup), "strike")),
  ];
}

function parseInline(source: string, lookup?: EmojiLookup): RichNode[] {
  const all = matchers(lookup);
  const out: RichNode[] = [];
  let rest = source;
  while (rest) {
    let best: { index: number; length: number; nodes: RichNode[] } | null = null;
    for (const match of all) {
      const found = match(rest);
      if (found && (!best || found.index < best.index)) best = found;
    }
    if (!best) break;
    if (best.index > 0) out.push(text(rest.slice(0, best.index)));
    out.push(...best.nodes);
    rest = rest.slice(best.index + best.length);
  }
  if (rest) out.push(text(rest));
  return out;
}

const paragraph = (line: string, lookup?: EmojiLookup): RichNode => {
  const content = parseInline(line, lookup);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

/** Text as the editor's document: fences, `> ` lines, `• ` and `1. ` lines, then the inline markers. A `:name:` becomes an emoji only when `lookup` knows it. */
export function mrkdwnToDoc(source: string, lookup?: EmojiLookup): RichNode {
  const lines = source.split("\n");
  const content: RichNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      const single = /^\s*```(.+?)```\s*$/.exec(line);
      if (single) {
        content.push({ type: "codeBlock", content: [text(single[1])] });
        i++;
        continue;
      }
      const close = lines.findIndex((l, k) => k > i && l.includes("```"));
      if (close !== -1) {
        const code = [line.trimStart().slice(3), ...lines.slice(i + 1, close), lines[close].slice(0, lines[close].indexOf("```"))].filter((l, k, all) => !(l === "" && (k === 0 || k === all.length - 1))).join("\n");
        content.push({ type: "codeBlock", ...(code ? { content: [text(code)] } : {}) });
        i = close + 1;
        continue;
      }
    }
    const group = (re: RegExp) => {
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
      return items;
    };
    if (/^> ?/.test(line)) {
      content.push({ type: "blockquote", content: group(/^> ?/).map((l) => paragraph(l, lookup)) });
    } else if (/^\s*[•◦▪] /.test(line)) {
      content.push({ type: "bulletList", content: group(/^\s*[•◦▪] /).map((l) => ({ type: "listItem", content: [paragraph(l, lookup)] })) });
    } else if (/^\s*\d+\. /.test(line)) {
      content.push({ type: "orderedList", content: group(/^\s*\d+\. /).map((l) => ({ type: "listItem", content: [paragraph(l, lookup)] })) });
    } else {
      content.push(paragraph(line, lookup));
      i++;
    }
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Whether the document is a single line of nothing but emoji (characters or emoji images), which is drawn large. */
export function docIsEmojiOnly(doc: RichNode): boolean {
  const blocks = doc.content ?? [];
  if (blocks.length !== 1 || blocks[0].type !== "paragraph") return false;
  // An emoji image counts as one pictograph; typed `:name:` letters are not an emoji.
  const flat = (blocks[0].content ?? []).map((n) => (n.type === "emoji" ? "\u{1F600}" : n.type === "text" ? (n.text ?? "") : "\n")).join("");
  return isEmojiOnly(flat);
}
