/**
 * Text with a little structure (bold words and links), for the trust pages whose member-facing content lives in
 * a typed list (`src/content/privacy.ts`). The page renders it (`RichText` in `src/components/trust/Trust.tsx`) and the staff
 * page reads the same value as plain words, so a sentence is written once.
 */
export type RichPart = string | { strong: string } | { link: string; text: string };
export type Rich = string | readonly RichPart[];

/** The trust pages, by the name the text uses for them ("the Privacy page"). A mention of one page on another is a link. */
const TRUST_PAGE_PATHS = { Privacy: "/privacy", Compliance: "/compliance", Security: "/security" } as const;
const TRUST_PAGE_NAME = /\b(Privacy|Compliance|Security) page\b/g;

/** A string with each mention of a trust page ("the Privacy page") split out as a link to it. */
function linkTrustPages(text: string): readonly RichPart[] {
  const parts: RichPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TRUST_PAGE_NAME)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ link: TRUST_PAGE_PATHS[match[1] as keyof typeof TRUST_PAGE_PATHS], text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}

/** The parts to render. Plain strings are searched for mentions of the Privacy, Compliance and Security pages, which become links. */
export function richParts(text: Rich): readonly RichPart[] {
  return (typeof text === "string" ? [text] : text).flatMap((part) => (typeof part === "string" ? linkTrustPages(part) : [part]));
}

/** The words a reader sees, with no markup. */
export function plainText(text: Rich): string {
  return richParts(text)
    .map((part) => (typeof part === "string" ? part : "strong" in part ? part.strong : part.text))
    .join("");
}
