import { IMAGE_ROUTE_PREFIXES } from "@/lib/courses/image-urls";

// What an address inside stored HTML (a lesson, a landing page's rich text) may be, checked by the two sanitizers
// before sanitize-html's own scheme check. A path on this site is a GET the member's browser makes by itself for an
// image, so an image may only name the image routes; a link may name a page but never an API route.
// docs/trust/THREAT_MODEL.md, A03. Production (2026-11-21) used only absolute http(s) and mailto addresses here.

// eslint-disable-next-line no-control-regex -- control characters can hide a scheme (java\tscript:)
const CONTROL = /[\u0000-\u001f\u007f]/;
const ABSOLUTE = /^(https?:\/\/|mailto:)/i;

function plainPath(value: string): boolean {
  const path = value.split(/[?#]/)[0];
  // A browser reads %2e as a dot and some servers read %2f and %5c as separators, so none may hide a way out of the prefix.
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/%(2e|2f|5c)/i.test(path) && !path.split("/").includes("..");
}

/** The link tag's attributes with `href` checked (dropped when not allowed) and the new-tab, no-opener pair set. */
export function safeLinkAttribs(attribs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...attribs, target: "_blank", rel: "noopener noreferrer" };
  if ("href" in out) {
    const href = allowedHtmlHref(out.href);
    if (href) out.href = href;
    else delete out.href;
  }
  return out;
}

/** The `href` to keep, or "" to drop it: http(s), mailto, an in-page anchor, or a page path on this site that is not under /api/. */
export function allowedHtmlHref(value: string | undefined): string {
  const href = (value ?? "").trim();
  if (!href || CONTROL.test(href)) return "";
  if (ABSOLUTE.test(href) || href.startsWith("#")) return href;
  if (!plainPath(href) || /^\/api(\/|$|[?#])/i.test(href)) return "";
  return href;
}

/** The image `src` to keep, or "" to drop it: http(s), or a path under one of the image routes. */
export function allowedHtmlImageSrc(value: string | undefined): string {
  const src = (value ?? "").trim();
  if (!src || CONTROL.test(src)) return "";
  if (/^https?:\/\//i.test(src)) return src;
  return plainPath(src) && IMAGE_ROUTE_PREFIXES.some((prefix) => src.startsWith(prefix)) ? src : "";
}
