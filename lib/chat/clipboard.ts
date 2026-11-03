import { unicodeEmoji } from "@/lib/chat/emoji";
import { parseSlackText, type Block, type Inline } from "@/lib/chat/render";

/**
 * A message as it goes on the clipboard from "Copy message": plain text a person can read (people and channels by name,
 * no markers such as `<u>`), and HTML with the formatting, which the chat box turns back into formatting when pasted and
 * other apps paste as styled text. Never the stored markup. Pure.
 */
export interface Names {
  userNames: Record<string, string>;
  channelNames: Record<string, string>;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function plainInline(nodes: Inline[], names: Names): string {
  return nodes
    .map((n): string => {
      switch (n.t) {
        case "text":
        case "code":
          return n.v;
        case "link":
          return n.label || n.href;
        case "user":
          return `@${names.userNames[n.id] ?? "someone"}`;
        case "channel":
          return `#${names.channelNames[n.id] ?? n.label ?? "channel"}`;
        case "special":
          return n.v.startsWith("@") ? n.v : `@${n.v}`;
        case "emoji":
          return unicodeEmoji(n.name) ?? `:${n.name}:`;
        default:
          return plainInline(n.c, names);
      }
    })
    .join("");
}

function htmlInline(nodes: Inline[], names: Names): string {
  return nodes
    .map((n): string => {
      switch (n.t) {
        case "bold":
          return `<strong>${htmlInline(n.c, names)}</strong>`;
        case "italic":
          return `<em>${htmlInline(n.c, names)}</em>`;
        case "strike":
          return `<s>${htmlInline(n.c, names)}</s>`;
        case "underline":
          return `<u>${htmlInline(n.c, names)}</u>`;
        case "code":
          return `<code>${escapeHtml(n.v)}</code>`;
        case "link":
          return `<a href="${escapeHtml(n.href)}">${escapeHtml(n.label || n.href)}</a>`;
        default:
          return escapeHtml(plainInline([n], names));
      }
    })
    .join("");
}

export function messageToClipboard(body: string, names: Names): { text: string; html: string } {
  const blocks: Block[] = parseSlackText(body);
  const text = blocks
    .map((b) => {
      if (b.t === "code") return b.v;
      const line = plainInline(b.c, names);
      return b.t === "bullet" ? `• ${line}` : b.t === "quote" ? `> ${line}` : line;
    })
    .join("\n");
  let html = "";
  let list = false;
  for (const b of blocks) {
    if (list && b.t !== "bullet") {
      html += "</ul>";
      list = false;
    }
    if (b.t === "bullet") {
      if (!list) html += "<ul>";
      list = true;
      html += `<li>${htmlInline(b.c, names)}</li>`;
    } else if (b.t === "quote") html += `<blockquote>${htmlInline(b.c, names)}</blockquote>`;
    else if (b.t === "code") html += `<pre><code>${escapeHtml(b.v)}</code></pre>`;
    else html += `<p>${htmlInline(b.c, names)}</p>`;
  }
  if (list) html += "</ul>";
  return { text, html };
}
