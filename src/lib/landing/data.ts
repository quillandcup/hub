/**
 * Landing page data (docs/product/LANDING_PAGES.md): Puck's JSON, `{ content: [...], root: { props } }`, kept in
 * `landing_pages.draft_data` / `published_data`. Pure helpers, safe in the browser and on the server.
 *
 * Conventions every block follows, so these helpers can work on any block without knowing it:
 * - a prop named `*AssetId` holds a media library asset id (collected on publish, made servable signed-out);
 * - a prop named `href` or `url` is a link and goes through `safeHref` before it is rendered;
 * - a prop named `html` is rich text and is cleaned (src/lib/landing/sanitize.ts) before the public render.
 */

import { allowedHtmlHref } from "@/lib/sanitize-urls";
import { migrateLandingData } from "./migrations";

export type LandingData = { content: unknown[]; root: Record<string, unknown>; zones?: Record<string, unknown[]>; schemaVersion?: number };

export const EMPTY_LANDING_DATA: LandingData = { content: [], root: {} };

/**
 * Puck's JSON as stored: tolerates null and half-formed values (a row written by hand), always returns the two keys,
 * and brings the document up to the current block props (src/lib/landing/migrations.ts).
 */
export function normalizeLandingData(value: unknown): LandingData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return migrateLandingData({ content: [], root: {} });
  const v = value as Record<string, unknown>;
  const root = v.root && typeof v.root === "object" && !Array.isArray(v.root) ? (v.root as Record<string, unknown>) : {};
  return migrateLandingData({ ...(v as object), content: Array.isArray(v.content) ? v.content : [], root } as LandingData);
}

/**
 * A link that is safe to put in an `href`: http(s), mailto, an in-page anchor, or a page path on this site that is not
 * under /api/. Anything else is dropped. The rule is the one the stored-HTML links use (`allowedHtmlHref`), so there is one
 * implementation; a staff-authored link is a click, not an automatic request, but one rule everywhere is simpler and safer.
 */
export function safeHref(value: unknown): string {
  return typeof value === "string" ? allowedHtmlHref(value) : "";
}

/** Walks any JSON value, calling `visit` on every property of every object, and rebuilds it from what `visit` returns. */
export function mapProps(value: unknown, visit: (key: string, value: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => mapProps(v, visit));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = mapProps(visit(key, inner), visit);
    return out;
  }
  return value;
}

/** Every media asset id the page uses (props named `*AssetId`), in first-seen order, without repeats. */
export function collectAssetIds(data: unknown): string[] {
  const ids = new Set<string>();
  mapProps(data, (key, value) => {
    if (key.endsWith("AssetId") && typeof value === "string" && value) ids.add(value);
    return value;
  });
  return [...ids];
}

/** The page with the value of every `*AssetId` prop passed through `fn` (the importer swaps its picture placeholders for library ids). */
export function mapAssetIds(data: LandingData, fn: (value: string) => string): LandingData {
  return mapProps(data, (key, value) => (key.endsWith("AssetId") && typeof value === "string" && value ? fn(value) : value)) as LandingData;
}

/** The link in `props.href`/`props.url` kept only if it is safe: the one rule for every block, applied on save and on render. */
export function cleanLinks(data: unknown): unknown {
  return mapProps(data, (key, value) => (key === "href" || key === "url" ? safeHref(value) : value));
}

export type Embed = { src: string; title: string; provider: "youtube" | "vimeo" | "mux" };

const YOUTUBE_ID = /^[\w-]{11}$/;

/**
 * The address a video page link plays from, for the hosts we allow (YouTube, Vimeo and Mux's player), or null.
 * Only the id is taken from the link; the embed address is built here, so a pasted link can't point the iframe anywhere else.
 */
export function parseEmbed(input: unknown): Embed | null {
  if (typeof input !== "string") return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return YOUTUBE_ID.test(id) ? { src: `https://www.youtube-nocookie.com/embed/${id}`, title: "YouTube video", provider: "youtube" } : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id = url.pathname.startsWith("/embed/") ? url.pathname.slice(7) : url.searchParams.get("v");
    return id && YOUTUBE_ID.test(id) ? { src: `https://www.youtube-nocookie.com/embed/${id}`, title: "YouTube video", provider: "youtube" } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.split("/").filter(Boolean).find((part) => /^\d+$/.test(part));
    return id ? { src: `https://player.vimeo.com/video/${id}?dnt=1`, title: "Vimeo video", provider: "vimeo" } : null;
  }
  if (host === "player.mux.com") {
    const id = url.pathname.slice(1);
    return /^[A-Za-z0-9]+$/.test(id) ? { src: `https://player.mux.com/${id}`, title: "Video", provider: "mux" } : null;
  }
  return null;
}
