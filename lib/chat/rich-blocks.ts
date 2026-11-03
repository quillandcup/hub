import { escapeForSlack } from "@/lib/chat/slack-escape";
import { parseSlackText, type Block, type Inline } from "@/lib/chat/render";

/**
 * Underline. Slack's mrkdwn (the `text` a Hub message is posted as) has no underline; its rich-text blocks do
 * (`style.underline`). So a message that has an underline is posted as `rich_text` blocks (with its text, minus the
 * underline, as the fallback), and a message read back with an underline in its blocks is shown from them. In between
 * the Hub keeps its own marker, `<u>underline</u>`, in the body: the editor writes it (lib/chat/rich-text.ts), the chat
 * draws it (lib/chat/render.ts), and these functions turn it to blocks and blocks back to it. Only messages with an
 * underline take this path; every other message is plain mrkdwn as before.
 */

type Style = { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; underline?: boolean };
type Leaf =
  | { type: "text"; text: string; style?: Style }
  | { type: "link"; url: string; text?: string; style?: Style }
  | { type: "user"; user_id: string; style?: Style }
  | { type: "channel"; channel_id: string; style?: Style }
  | { type: "usergroup"; usergroup_id: string; style?: Style }
  | { type: "broadcast"; range: string; style?: Style }
  | { type: "emoji"; name: string };
type Section = { type: "rich_text_section"; elements: Leaf[] };
type ListElement = { type: "rich_text_list"; style: "bullet" | "ordered"; indent: number; offset?: number; elements: Section[] };
export type RichTextBlock = {
  type: "rich_text";
  elements: (Section | ListElement | { type: "rich_text_quote"; elements: Leaf[] } | { type: "rich_text_preformatted"; elements: Leaf[] })[];
};

const UNDERLINE = /<u>[^\n]+?<\/u>/;

/** Whether a body has an underline in it. */
export const hasUnderline = (body: string): boolean => UNDERLINE.test(body);

/** The body without its underline markers (the text to post as the fallback). */
export const stripUnderline = (body: string): string => body.replace(/<\/?u>/g, "");

// ---- body to blocks --------------------------------------------------------------------------------------------

const withStyle = (style: Style | undefined, flag: keyof Style): Style => ({ ...style, [flag]: true });
const styled = <T extends object>(leaf: T, style?: Style): T => (style && Object.keys(style).length ? { ...leaf, style } : leaf);

function leaves(nodes: Inline[], style?: Style): Leaf[] {
  return nodes.flatMap((n): Leaf[] => {
    switch (n.t) {
      case "text":
        return n.v ? [styled({ type: "text" as const, text: n.v }, style)] : [];
      case "bold":
      case "italic":
      case "strike":
      case "underline":
        return leaves(n.c, withStyle(style, n.t));
      case "code":
        return [styled({ type: "text" as const, text: n.v }, withStyle(style, "code"))];
      case "link":
        return [styled({ type: "link" as const, url: n.href, ...(n.label && n.label !== n.href ? { text: n.label } : {}) }, style)];
      case "user":
        return [styled({ type: "user" as const, user_id: n.id }, style)];
      case "channel":
        return [styled({ type: "channel" as const, channel_id: n.id }, style)];
      case "emoji":
        return [{ type: "emoji", name: n.name }];
      case "special": {
        const raw = n.raw ?? "";
        if (/^(here|channel|everyone)/.test(raw)) return [styled({ type: "broadcast" as const, range: raw.split("|")[0] }, style)];
        const group = /^subteam\^([A-Z0-9]+)/.exec(raw);
        return group ? [styled({ type: "usergroup" as const, usergroup_id: group[1] }, style)] : [styled({ type: "text" as const, text: n.v }, style)];
      }
    }
  });
}

const newline = (count: number): Leaf => ({ type: "text", text: "\n".repeat(count) });

function toBlocks(blocks: Block[]): RichTextBlock {
  const elements: RichTextBlock["elements"] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.t === "line") {
      // Consecutive lines are one section, a blank line before one kept as an extra newline.
      const section: Leaf[] = [];
      for (; i < blocks.length && blocks[i].t === "line"; i++) {
        const line = blocks[i] as Extract<Block, { t: "line" }>;
        if (section.length) section.push(newline(line.gap ? 2 : 1));
        section.push(...leaves(line.c));
      }
      elements.push({ type: "rich_text_section", elements: section });
    } else if (b.t === "bullet") {
      // Slack's lists are flat: one `rich_text_list` for each run of items with the same style and depth (a nested list is the
      // next element, with a deeper `indent`), and a numbered one that picks up again says how many items came before (`offset`).
      let current: ListElement | null = null;
      for (; i < blocks.length && blocks[i].t === "bullet"; i++) {
        const item = blocks[i] as Extract<Block, { t: "bullet" }>;
        const style = item.n === undefined ? "bullet" : "ordered";
        if (!current || current.style !== style || current.indent !== item.indent) {
          current = { type: "rich_text_list", style, indent: item.indent, ...(item.n && item.n > 1 ? { offset: item.n - 1 } : {}), elements: [] };
          elements.push(current);
        }
        current.elements.push({ type: "rich_text_section", elements: leaves(item.c) });
      }
    } else if (b.t === "quote") {
      const quoted: Leaf[] = [];
      for (; i < blocks.length && blocks[i].t === "quote"; i++) {
        if (quoted.length) quoted.push(newline(1));
        quoted.push(...leaves((blocks[i] as Extract<Block, { t: "quote" }>).c));
      }
      elements.push({ type: "rich_text_quote", elements: quoted });
    } else {
      elements.push({ type: "rich_text_preformatted", elements: [{ type: "text", text: b.v }] });
      i++;
    }
  }
  return { type: "rich_text", elements };
}

// The underline markers pass through the escaping (which would turn their angle brackets into text) as private-use characters.
const OPEN = "";
const CLOSE = "";

/**
 * A body as Slack rich-text blocks. `plain` is a body written in the Hub (text that only carries mention and link
 * tokens, nothing escaped); otherwise it is Slack's own mrkdwn (a message edited from its Slack text).
 */
export function bodyToBlocks(body: string, opts: { plain: boolean }): RichTextBlock[] {
  const marked = body.replace(/<u>/g, OPEN).replace(/<\/u>/g, CLOSE);
  const escaped = opts.plain ? escapeForSlack(marked) : marked;
  return [toBlocks(parseSlackText(escaped.replace(//g, "<u>").replace(//g, "</u>")))];
}

// ---- blocks to body --------------------------------------------------------------------------------------------

const ENTITIES = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Slack ignores emphasis with a space just inside the marker, so the markers hug the words. */
function hug(inner: string, open: string, close: string): string {
  const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return body ? `${lead}${open}${body}${close}${trail}` : inner;
}

function leafText(leaf: Record<string, unknown>, escape: (s: string) => string): string {
  switch (leaf.type) {
    case "text":
      return escape(str(leaf.text));
    case "link": {
      const url = str(leaf.url);
      const label = escape(str(leaf.text)).replace(/[<>|]/g, "");
      return url ? `<${url.replace(/&/g, "&amp;")}${label && label !== url ? `|${label}` : ""}>` : label;
    }
    case "user":
      return `<@${str(leaf.user_id)}>`;
    case "channel":
      return `<#${str(leaf.channel_id)}>`;
    case "usergroup":
      return `<!subteam^${str(leaf.usergroup_id)}>`;
    case "broadcast":
      return `<!${str(leaf.range) || "here"}>`;
    case "emoji":
      return `:${str(leaf.name)}:`;
    case "date":
      return escape(str(leaf.fallback) || String(leaf.timestamp ?? ""));
    case "color":
      return str(leaf.value);
    default:
      return "";
  }
}

function inline(leaves: Record<string, unknown>[], escape: (s: string) => string): string {
  return leaves
    .map((leaf) => {
      let out = leafText(leaf, escape);
      const style = isRecord(leaf.style) ? leaf.style : {};
      // Innermost first: code, strikethrough, italics, bold, underline.
      if (style.code) out = hug(out, "`", "`");
      if (style.strike) out = hug(out, "~", "~");
      if (style.italic) out = hug(out, "_", "_");
      if (style.bold) out = hug(out, "*", "*");
      // Unlike the others, an underline has no space rule: a space inside it is underlined, as in Slack.
      if (style.underline && out) out = `<u>${out}</u>`;
      return out;
    })
    .join("")
    // Neighbouring elements that are both underlined are one underline.
    .replace(/<\/u><u>/g, "");
}

const anyUnderline = (v: unknown): boolean =>
  Array.isArray(v) ? v.some(anyUnderline) : isRecord(v) ? (isRecord(v.style) && v.style.underline === true) || Object.values(v).some(anyUnderline) : false;

/**
 * The body for a message whose blocks have an underline, or null when they don't (its own text is then right). `plain`
 * is a message written in the Hub: its body keeps nothing escaped and a raw `>` for a quote; a Slack-written one is
 * Slack's escaped mrkdwn.
 */
export function blocksToBody(blocks: unknown, opts: { plain: boolean }): string | null {
  if (!anyUnderline(blocks)) return null;
  const escape = opts.plain ? (s: string) => s : ENTITIES;
  const quote = opts.plain ? ">" : "&gt;";
  const parts: string[] = [];
  for (const block of list(blocks)) {
    if (block.type !== "rich_text") continue;
    for (const el of list(block.elements)) {
      const kids = list(el.elements);
      if (el.type === "rich_text_section") parts.push(inline(kids, escape));
      else if (el.type === "rich_text_quote") parts.push(inline(kids, escape).split("\n").map((l) => `${quote} ${l}`).join("\n"));
      else if (el.type === "rich_text_preformatted") parts.push(`\`\`\`\n${kids.map((k) => escape(str(k.text))).join("")}\n\`\`\``);
      else if (el.type === "rich_text_list") {
        const ordered = el.style === "ordered";
        const pad = "  ".repeat(Number(el.indent ?? 0));
        const offset = Number(el.offset ?? 0);
        kids.forEach((item, n) => parts.push(`${pad}${ordered ? `${offset + n + 1}. ` : "• "}${inline(list(item.elements), escape)}`));
      }
    }
  }
  return parts.map((p) => p.replace(/\n+$/, "")).join("\n");
}
