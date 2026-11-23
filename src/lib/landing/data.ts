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

/** Two documents are the same whatever order their keys come in (the database sorts them). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export const sameDocument = (a: unknown, b: unknown) => canonical(a) === canonical(b);

const isEmptyValue = (v: unknown) => v === false || v === "" || v === undefined || v === null || (Array.isArray(v) && v.length === 0);

/**
 * The page as a reader would see it, for comparing a draft with the live copy. Puck adds an empty `zones` and the page-level
 * settings at their defaults (all off or empty, the same as absent) to what it hands back, and the version marker depends on when
 * a copy was last saved; none of them change the page.
 */
function comparableLandingData(value: unknown): unknown {
  const { schemaVersion: _version, zones, root, ...rest } = normalizeLandingData(value) as LandingData & { schemaVersion?: unknown; zones?: Record<string, unknown[]> };
  const rootRecord = root as { props?: Record<string, unknown> } & Record<string, unknown>;
  const { props, ...rootRest } = rootRecord;
  const keptProps = Object.fromEntries(Object.entries(props ?? {}).filter(([, v]) => !isEmptyValue(v)));
  const keptZones = Object.fromEntries(Object.entries(zones ?? {}).filter(([, list]) => !isEmptyValue(list)));
  return { ...rest, root: { ...rootRest, ...(Object.keys(keptProps).length ? { props: keptProps } : {}) }, ...(Object.keys(keptZones).length ? { zones: keptZones } : {}) };
}

/** True when a draft and the live copy are the same page, whatever order their keys are in and whatever defaults one of them spells out. */
export const sameLandingPage = (a: unknown, b: unknown) => sameDocument(comparableLandingData(a), comparableLandingData(b));
