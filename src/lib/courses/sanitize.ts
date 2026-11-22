import sanitizeHtml from "sanitize-html";
import { allowedHtmlImageSrc, safeLinkAttribs } from "@/lib/sanitize-urls";

/**
 * Lesson text from Kajabi's editor, reduced to an allowlist before it's stored (docs/product/COURSES.md:
 * headings, lists, links, emphasis, images). It is never rendered raw. Styles, classes, ids,
 * scripts, iframes and event handlers are all dropped; links open in a new tab without
 * leaking the opener; only http(s) images and http(s)/mailto links survive.
 */
export function sanitizeLessonHtml(html: string | null | undefined): string | null {
  if (!html || !html.trim()) return null;
  return sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr", "blockquote", "pre", "code",
      "ul", "ol", "li",
      "strong", "b", "em", "i", "u", "s", "sub", "sup",
      "a", "img",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: safeLinkAttribs(attribs) }),
      // http(s) or our own image routes only (src/lib/sanitize-urls.ts); any other path on this site is dropped.
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, src: allowedHtmlImageSrc(attribs.src) } }),
    },
    // An image whose src was removed (a data: or protocol-relative URL) is just noise.
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
    // Drop the contents of tags that must never show as text either.
    nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  });
}
