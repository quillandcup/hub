import { clock } from "@/lib/clock";
import { KAJABI_SITE_URL, ORG_TIMEZONE } from "@/lib/config";
import { safeHref } from "@/lib/landing/data";
import { zonedLocalToUtc } from "@/lib/landing/countdown";
import { safeGet } from "@/lib/net/safe-fetch";

/**
 * What a Kajabi export names but does not say, looked up when the admin imports (docs/product/LANDING_PAGES.md,
 * "Importing from Kajabi"): the address a `/resource_redirect/landing_pages/<id>` link points at, the checkout link of
 * an offer, and the date a countdown counts down to. The mapper (`mapKajabiPage`) stays pure and offline: it reports
 * what it needs (`KajabiReferences`) and takes the answers (`KajabiLookups`). Whatever cannot be looked up is simply
 * absent, and the mapper falls back to what it did before (the link as it was, a countdown without a date, each with a note).
 *
 * The only addresses fetched are on the Kajabi site's own host (`kajabiSiteUrl` in config/app.ts): a landing page's
 * redirect and the public page the admin names by its path. Never an address that came from the export or from a
 * typed URL: the ids and the path are checked against fixed shapes and put after the host from config.
 */

/** A countdown block in the export: where it is (section and block keys, which Kajabi also writes into its page's HTML) and the event it names. */
export type CountdownRef = { key: string; sectionKey: string; blockKey: string; eventId: string };

export type KajabiReferences = { landingPageIds: string[]; offerCodes: string[]; countdowns: CountdownRef[] };

export type CountdownLookup = { ok: true; at: string; path: string; readOn: string; past: boolean } | { ok: false; problem: string };

export type KajabiLookups = {
  /** Landing page id -> the path the Kajabi site sends it to (`/waitlist`). */
  pagePaths: Record<string, string>;
  /** Offer code -> the offer's checkout address as the Hub already holds it. */
  offerLinks: Record<string, string>;
  /** Countdown key (`CountdownRef.key`) -> its date, or why it is not known. */
  countdowns: Record<string, CountdownLookup>;
};

// ---- reading what the live page says -------------------------------------------------------------------------------

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * The instant of a Kajabi `data-event-time`: `2026-07-19T07:00:00-05:00`, or its ordinal-day form `2026-200T07:00:00-05:00`
 * (which is what the live page has been seen to carry), with `Z`, an offset or none (none means the organization's zone, so the
 * result does not depend on the machine's). Null when it is not one of those or not a real date.
 */
export function parseEventTime(raw: string): string | null {
  const m = /^(\d{4})-(?:(\d{2})-(\d{2})|(\d{3}))T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const hour = Number(m[5]);
  const minute = Number(m[6]);
  const second = Number(m[7] ?? "0");
  if (year < MIN_YEAR || year > MAX_YEAR || hour > 23 || minute > 59 || second > 59) return null;
  let month: number;
  let day: number;
  if (m[4]) {
    const ordinal = Number(m[4]);
    const date = new Date(Date.UTC(year, 0, ordinal));
    if (ordinal < 1 || date.getUTCFullYear() !== year) return null;
    month = date.getUTCMonth() + 1;
    day = date.getUTCDate();
  } else {
    month = Number(m[2]);
    day = Number(m[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const zone = m[8];
  if (!zone) return zonedLocalToUtc(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
  return new Date(wall - offset * 60_000).toISOString();
}

const KEY = /^[A-Za-z0-9_]+$/;

/** The date a countdown block counts down to, read from the public page's HTML (the block's `event` element has `data-event-time`). */
export function findCountdownDate(html: string, sectionKey: string, blockKey: string): { at: string } | { problem: string } {
  if (!KEY.test(sectionKey) || !KEY.test(blockKey)) return { problem: "the countdown's ids are not ones the live page uses" };
  const marker = `kjb-settings-id="sections_${sectionKey}_blocks_${blockKey}_settings_event"`;
  const at = html.indexOf(marker);
  if (at < 0) return { problem: "that page has no countdown like this one" };
  const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
  const attribute = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1]?.trim() ?? "";
  if (attribute("data-offset-number") || attribute("data-offset-period")) return { problem: "the live countdown is set relative to another time, which has no counterpart here" };
  const raw = attribute("data-event-time");
  if (!raw) return { problem: "the live countdown has no date" };
  const instant = parseEventTime(raw);
  return instant ? { at: instant } : { problem: "the live countdown's date isn't in a form we can read" };
}

/** A path on the Kajabi site (`/bff-program`): what an admin may give to say which public page a countdown is on. */
export function validOriginalPath(value: string): string | null {
  const path = value.trim();
  return /^\/[A-Za-z0-9][A-Za-z0-9_\-/]{0,120}$/.test(path) && !path.includes("//") && !/^\/(resource_redirect|api)(\/|$)/.test(path) ? path : null;
}

/** Whether an address is the Kajabi site itself (its host, with or without `www.`, which is how the root domain answers once the Hub serves it). */
function onKajabiHost(url: URL, siteUrl: string): boolean {
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return url.protocol === "https:" && bare(url.hostname) === bare(new URL(siteUrl).hostname);
}

// ---- fetching ------------------------------------------------------------------------------------------------------

const HEAD_TIMEOUT_MS = 5_000;
const PAGE_TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
/** More distinct pages than this in one export is not a page we know; the rest keep their links as they were. */
const MAX_LANDING_PAGES = 20;

export interface LookupFetchers {
  /** Where an address ends up after its redirects (nothing is downloaded), or null when it can't be reached. */
  finalUrl(url: string): Promise<string | null>;
  /** A public page's HTML, or null. */
  html(url: string): Promise<string | null>;
}

export const defaultLookupFetchers: LookupFetchers = {
  async finalUrl(url) {
    const got = await safeGet(url, { maxBytes: 1024, timeoutMs: HEAD_TIMEOUT_MS, allowHttp: false, accept: "text/html", wantBody: () => false });
    return got.ok ? got.finalUrl : null;
  },
  async html(url) {
    const got = await safeGet(url, { maxBytes: PAGE_MAX_BYTES, timeoutMs: PAGE_TIMEOUT_MS, allowHttp: false, accept: "text/html" });
    return got.ok ? got.bytes.toString("utf8") : null;
  },
};

export interface ResolveDeps {
  fetchers?: LookupFetchers;
  /** The offers the Hub holds, with their raw record (`data.attributes.checkout_url`). Read only when the export links to an offer. */
  offers?: () => Promise<{ data: unknown }[]>;
  siteUrl?: string;
}

/** The checkout address of each wanted offer code that the Hub's offers have: the offer's `checkout_url`, when it ends in `/offers/<code>`. */
export function offerLinksFrom(offers: { data: unknown }[], codes: string[]): Record<string, string> {
  const wanted = new Set(codes);
  const out: Record<string, string> = {};
  for (const offer of offers) {
    const raw = (offer.data as { attributes?: { checkout_url?: unknown } } | null)?.attributes?.checkout_url;
    if (typeof raw !== "string") continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const code = /^\/offers\/([A-Za-z0-9]+)\/?$/.exec(url.pathname)?.[1];
    const href = safeHref(raw);
    if (code && wanted.has(code) && url.protocol === "https:" && href && !out[code]) out[code] = href;
  }
  return out;
}

const dayOf = (instant: number) => new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, dateStyle: "long" }).format(new Date(instant));

/**
 * Looks up what the export referenced. Each part fails on its own and quietly: a page that doesn't answer leaves its links as they were,
 * an offer the Hub doesn't know keeps the general link, a countdown without a readable date keeps its to-do. `originalPath` is the public
 * page the export came from (the export doesn't say), needed only for a countdown.
 */
export async function resolveReferences(refs: KajabiReferences, input: { originalPath?: string }, deps: ResolveDeps = {}): Promise<KajabiLookups> {
  const fetchers = deps.fetchers ?? defaultLookupFetchers;
  const siteUrl = deps.siteUrl ?? KAJABI_SITE_URL;
  const lookups: KajabiLookups = { pagePaths: {}, offerLinks: {}, countdowns: {} };

  const pages = refs.landingPageIds.filter((id) => /^\d{1,20}$/.test(id)).slice(0, MAX_LANDING_PAGES);
  const wantedCodes = refs.offerCodes.filter((code) => /^[A-Za-z0-9]{3,40}$/.test(code));

  await Promise.all([
    ...pages.map(async (id) => {
      const final = await fetchers.finalUrl(new URL(`/resource_redirect/landing_pages/${id}`, siteUrl).href).catch(() => null);
      if (!final) return;
      let url: URL;
      try {
        url = new URL(final);
      } catch {
        return;
      }
      const path = url.pathname.replace(/\/+$/, "");
      if (onKajabiHost(url, siteUrl) && path.length > 1 && !path.startsWith("/resource_redirect/") && safeHref(path)) lookups.pagePaths[id] = path;
    }),
    (async () => {
      if (wantedCodes.length === 0 || !deps.offers) return;
      lookups.offerLinks = offerLinksFrom(await deps.offers().catch(() => []), wantedCodes);
    })(),
    ...refs.countdowns.map(async (ref) => {
      const path = input.originalPath ? validOriginalPath(input.originalPath) : null;
      if (!path) {
        lookups.countdowns[ref.key] = { ok: false, problem: input.originalPath ? "that isn't a page address on the Kajabi site" : "no page address was given" };
        return;
      }
      const html = await fetchers.html(new URL(path, siteUrl).href).catch(() => null);
      if (html === null) {
        lookups.countdowns[ref.key] = { ok: false, problem: `the live page ${path} couldn't be read` };
        return;
      }
      const found = findCountdownDate(html, ref.sectionKey, ref.blockKey);
      lookups.countdowns[ref.key] = "problem" in found ? { ok: false, problem: found.problem } : { ok: true, at: found.at, path, readOn: dayOf(clock.now()), past: Date.parse(found.at) <= clock.now() };
    }),
  ]);
  return lookups;
}
