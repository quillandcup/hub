import type { JSONContent } from "@tiptap/react";
import { joinPlaceholders, splitPlaceholders, type PlaceholderSegment } from "@/lib/landing/placeholders";

/**
 * The stored text and the one-line editor's document, both ways. The text is the plain token string (`© {year:2019} Fern`), which is
 * all that is ever saved; the document is one paragraph of text and `placeholder` atoms. Anything in braces that is not a known,
 * valid placeholder is just text, so `toText(toDoc(text)) === text` for every string without a line break.
 */

export function toDoc(text: string): JSONContent {
  const content: JSONContent[] = splitPlaceholders(text).map((s) =>
    s.kind === "text" ? { type: "text", text: s.text } : { type: "placeholder", attrs: { name: s.name, param: s.param ?? null } }
  );
  return { type: "doc", content: [{ type: "paragraph", ...(content.length ? { content } : {}) }] };
}

export function toText(doc: JSONContent): string {
  const segments: PlaceholderSegment[] = [];
  for (const paragraph of doc.content ?? []) {
    for (const node of paragraph.content ?? []) {
      if (node.type === "placeholder") segments.push({ kind: "placeholder", name: String(node.attrs?.name ?? ""), ...(node.attrs?.param ? { param: String(node.attrs.param) } : {}) });
      else if (node.type === "text") segments.push({ kind: "text", text: node.text ?? "" });
    }
  }
  return joinPlaceholders(segments);
}

/** Pasted or typed line breaks and runs of spaces from them become one space: the field is one line. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n\v\f]\s*/g, " ");
}
