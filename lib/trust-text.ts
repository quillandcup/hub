/**
 * Text with a little structure (bold words and links), for the trust pages whose member-facing content lives in
 * a typed list (`lib/privacy.ts`). The page renders it (`RichText` in `components/trust/Trust.tsx`) and the staff
 * page reads the same value as plain words, so a sentence is written once.
 */
export type RichPart = string | { strong: string } | { link: string; text: string };
export type Rich = string | readonly RichPart[];

export function richParts(text: Rich): readonly RichPart[] {
  return typeof text === "string" ? [text] : text;
}

/** The words a reader sees, with no markup. */
export function plainText(text: Rich): string {
  return richParts(text)
    .map((part) => (typeof part === "string" ? part : "strong" in part ? part.strong : part.text))
    .join("");
}
