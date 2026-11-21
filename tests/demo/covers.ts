/**
 * Fictional book covers for the demo: a coloured gradient with the title and a pen name, drawn with sharp.
 * Deterministic (same input, same bytes), so the media library's "same file is one asset" rule keeps a re-seed from
 * adding copies. Invented titles only (the repo is public).
 */
import sharp from "sharp";

export const COVER_WIDTH = 640;
export const COVER_HEIGHT = 960;

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Breaks a title into lines of at most `max` characters, on spaces. */
export function wrapTitle(title: string, max = 16): string[] {
  const lines: string[] = [];
  for (const word of title.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

export interface CoverSpec {
  title: string;
  author: string;
  /** Two CSS colours the gradient runs between, top to bottom. */
  colors: [string, string];
}

/** The cover as SVG markup. */
export function coverSvg({ title, author, colors }: CoverSpec): string {
  const lines = wrapTitle(title);
  const startY = 330 - ((lines.length - 1) * 70) / 2;
  const text = lines.map((line, i) => `<text x="320" y="${startY + i * 70}" text-anchor="middle" font-family="Georgia, serif" font-size="56" font-weight="bold" fill="#ffffff">${escapeXml(line)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<rect x="36" y="36" width="568" height="888" fill="none" stroke="#ffffff" stroke-opacity="0.6" stroke-width="4"/>
${text}
<text x="320" y="860" text-anchor="middle" font-family="Georgia, serif" font-size="34" fill="#ffffff">${escapeXml(author)}</text>
</svg>`;
}

/** The cover as a PNG. */
export async function coverPng(spec: CoverSpec): Promise<Buffer> {
  return sharp(Buffer.from(coverSvg(spec))).png().toBuffer();
}
