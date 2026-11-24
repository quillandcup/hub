/**
 * Reading Slack's rich-text blocks back into a Hub body: a message whose blocks have an underline is shown from them (its own text has
 * none), and so is a Hub-written message with a list (Slack hands back its text with the line breaks gone). The other direction, a body to blocks for posting, is `rich-blocks.ts` in this folder. Core asks for this through the port
 * (`bodyFromBlocks`) and never sees the block format.
 */

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

const anyList = (v: unknown): boolean =>
  Array.isArray(v) ? v.some(anyList) : isRecord(v) ? v.type === "rich_text_list" || Object.values(v).some(anyList) : false;

/**
 * The body for a message whose blocks have an underline, or (for a message written in the Hub) a list, or null when they
 * don't (its own text is then right). A Hub message with a list is posted as blocks, and the text Slack sends back for those
 * has no line breaks, which would replace the body the Hub kept. `plain`
 * is a message written in the Hub: its body keeps nothing escaped and a raw `>` for a quote; a Slack-written one is
 * Slack's escaped mrkdwn.
 */
export function blocksToBody(blocks: unknown, opts: { plain: boolean }): string | null {
  if (!anyUnderline(blocks) && !(opts.plain && anyList(blocks))) return null;
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
