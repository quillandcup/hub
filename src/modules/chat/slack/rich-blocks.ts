import { escapeForSlack } from "./escape";
import { parseSlackText, type Block, type Inline } from "@/lib/chat/render";

/**
 * Underline. Slack's mrkdwn (the `text` a Hub message is posted as) has no underline; its rich-text blocks do
 * (`style.underline`). So a message that has an underline is posted as `rich_text` blocks (with its text, minus the
 * underline, as the fallback), and a message read back with an underline in its blocks is shown from them. In between
 * the Hub keeps its own marker, `<u>underline</u>`, in the body: the editor writes it (src/lib/chat/rich-text.ts), the chat
 * draws it (src/lib/chat/render.ts), and these functions turn it to blocks and blocks back to it. Only messages with an
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

/**
 * Whether a body says something Slack's mrkdwn can't: an underline, or a list. (A `•` or `1.` line in a post's text is just
 * text to Slack, not a list, and a nested one even less so.) Such a message is sent as rich-text blocks, with its text as the
 * fallback; every other message goes as plain mrkdwn as before.
 */
export const needsBlocks = (body: string): boolean => hasUnderline(body) || parseSlackText(body).some((b) => b.t === "bullet");

/** Whether Slack refused the blocks themselves, in which case the message is sent again as plain text rather than lost. */
export const isInvalidBlocks = (error: unknown): boolean => (error as { data?: { error?: string } } | null)?.data?.error === "invalid_blocks";

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
