import { parse } from "parse5";

/**
 * What a linked page says about itself, read from the head of its HTML for a preview card (docs/SLACK_BRIDGED_CHAT.md,
 * "Link previews"). The page is somebody else's and may be hostile, huge or broken, so:
 *  - only the head is looked at (the text is cut at `</head>` or `<body` before parsing), by parse5, a spec-compliant parser that
 *    never runs anything and decodes entities once, instead of patterns over markup;
 *  - every text is plain text: control and direction-override characters are dropped, whitespace collapsed, length capped;
 *  - the picture must be an https address, resolved against the page's own address; anything else (a `data:` URL, `javascript:`,
 *    plain http) is dropped. The picture is never loaded by the browser from there: it goes through the Hub's picture route.
 * `<meta name="robots">` is not consulted: it is advice to search engines about indexing the page, not about showing a link.
 */

export const MAX_TITLE = 300;
export const MAX_DESCRIPTION = 600;
export const MAX_SITE_NAME = 100;
export const MAX_URL = 2000;
/** How much of the head is parsed. */
export const MAX_HEAD_CHARS = 128 * 1024;
/** And how many `<` it may hold. */
export const MAX_HEAD_TAGS = 6000;

export interface PagePreview {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
}

// C0/C1 controls (tab and newline become spaces first), zero-width and bidirectional formatting characters, the BOM and the object marker.
// Built from code points, not a literal, so the source holds no invisible characters.
const UNWANTED_RANGES: [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xfffc, 0xfffc],
];
const hex = (n: number) => `\\u${n.toString(16).padStart(4, "0")}`;
const UNWANTED = new RegExp(`[${UNWANTED_RANGES.map(([from, to]) => `${hex(from)}-${hex(to)}`).join("")}]`, "g");
/** Whitespace that is not a plain space (tabs, newlines, no-break space, line and paragraph separators): one space. */
const ODD_SPACE = new RegExp(`[${[0x09, 0x0a, 0x0d, 0x0c, 0xa0, 0x2028, 0x2029].map(hex).join("")}]+`, "g");

/** Plain text for a card: no control or direction characters, whitespace collapsed, at most `max` characters (not cut inside a pair); null when empty. */
export function cleanText(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value.replace(ODD_SPACE, " ").replace(UNWANTED, "").replace(/ {2,}/g, " ").trim();
  if (!text) return null;
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

/** An https address for a picture, resolved against the page's, or null. */
export function httpsImageUrl(value: string | null | undefined, base: string): string | null {
  if (!value || value.length > MAX_URL) return null;
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href.length <= MAX_URL ? url.href : null;
  } catch {
    return null;
  }
}

/** The page's text from its bytes: the charset the server said, else one the page declares near its start, else UTF-8. */
export function decodePage(bytes: Uint8Array, contentType: string | null): string {
  const label = (v: string | undefined) => {
    const name = v?.trim().replace(/^["']|["']$/g, "");
    if (!name) return null;
    try {
      return new TextDecoder(name).encoding ? name : null;
    } catch {
      return null;
    }
  };
  let charset = label(/charset\s*=\s*([^;\s]+)/i.exec(contentType ?? "")?.[1]);
  if (!charset) {
    // Declared in the first kilobyte, in ASCII-compatible bytes (`<meta charset=...>` or the http-equiv form).
    const start = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
    charset = label(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(start)?.[1]);
  }
  return new TextDecoder(charset ?? "utf-8").decode(bytes);
}

interface Node {
  nodeName: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
}

const attr = (n: Node, name: string): string | undefined => n.attrs?.find((a) => a.name === name)?.value;

function walk(n: Node, visit: (n: Node) => void, depth = 0): void {
  visit(n);
  // A page can nest elements far deeper than anything real; the head is shallow.
  if (depth < 50) for (const c of n.childNodes ?? []) walk(c, visit, depth + 1);
}

/** The part of the document worth parsing: everything before the body starts. */
function headOf(html: string): string {
  const end = /<\/head\s*>|<body[\s>]/i.exec(html);
  // Real heads are small and the tags worth reading come early, while a parser's time grows faster than its input (thousands of unclosed
  // elements nest ever deeper), so what it is given is cut by size and by number of tags.
  const head = (end ? html.slice(0, end.index) : html).slice(0, MAX_HEAD_CHARS);
  let at = -1;
  for (let tags = 0; tags < MAX_HEAD_TAGS; tags++) {
    at = head.indexOf("<", at + 1);
    if (at === -1) return head;
  }
  return head.slice(0, at);
}

/** Reads the preview out of a page's HTML. `pageUrl` is where it was served from, for resolving a relative picture address. */
export function parsePagePreview(html: string, pageUrl: string): PagePreview {
  const meta = new Map<string, string>();
  let titleTag: string | null = null;
  const doc = parse(`${headOf(html)}</head><body></body>`) as unknown as Node;
  walk(doc, (n) => {
    if (n.nodeName === "meta") {
      const key = (attr(n, "property") ?? attr(n, "name"))?.trim().toLowerCase();
      const content = attr(n, "content");
      // The first one wins, as a reader that stops at the first would see it.
      if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
    } else if (n.nodeName === "title" && titleTag === null) {
      titleTag = (n.childNodes ?? []).map((c) => c.value ?? "").join("");
    }
  });
  const first = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => cleanText(v, 1) !== null);
  return {
    title: cleanText(first("og:title", "twitter:title") ?? titleTag, MAX_TITLE),
    description: cleanText(first("og:description", "twitter:description", "description"), MAX_DESCRIPTION),
    siteName: cleanText(first("og:site_name", "application-name"), MAX_SITE_NAME),
    imageUrl: httpsImageUrl(first("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"), pageUrl),
  };
}
