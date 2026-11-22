import sanitizeHtml from "sanitize-html";
import { safeLinkAttribs } from "@/lib/sanitize-urls";
import { cleanLinks, mapProps, normalizeLandingData, type LandingData } from "./data";

/**
 * Rich text from a block's editor, reduced to an allowlist: paragraphs, headings, lists, quotes, emphasis, links.
 * No images, styles, classes, scripts or event handlers; links are http(s), mailto or on this site, and open
 * safely. Server only (sanitize-html is large): run on save and again before a public render.
 */
export function sanitizeRichText(html: unknown): string {
  if (typeof html !== "string" || !html.trim()) return "";
  return sanitizeHtml(html, {
    allowedTags: ["h2", "h3", "h4", "p", "br", "hr", "blockquote", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "a"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: { a: (tagName, attribs) => ({ tagName, attribs: safeLinkAttribs(attribs) }) },
    nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  });
}

/** The page data with every `html` prop cleaned and every link checked. What is stored and what the public page renders. */
export function sanitizeLandingData(value: unknown): LandingData {
  const data = normalizeLandingData(value);
  const cleaned = mapProps(data, (key, v) => (key === "html" ? sanitizeRichText(v) : v));
  return cleanLinks(cleaned) as LandingData;
}
