/**
 * What the search box remembers on this device (localStorage, never the server): recent searches,
 * recent places (pages you opened) and the two display toggles. Every read and write is guarded:
 * private windows and blocked storage just forget.
 */
export const SEARCHES_KEY = "hub:recent-searches";
export const PLACES_KEY = "hub:recent-places";
export const HISTORY_ON_KEY = "hub:search-history-on";
export const FILTERS_ON_KEY = "hub:search-filters-on";

const MAX_SEARCHES = 5;
const MAX_PLACES = 8;

export interface Place {
  href: string;
  title: string;
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing stored, nothing remembered.
  }
}

export function readSearches(): string[] {
  const parsed = readJson(SEARCHES_KEY);
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_SEARCHES) : [];
}

export function saveSearch(query: string) {
  const q = query.trim();
  if (!q) return;
  writeJson(SEARCHES_KEY, [q, ...readSearches().filter((r) => r !== q)].slice(0, MAX_SEARCHES));
}

export function removeSearch(query: string) {
  writeJson(SEARCHES_KEY, readSearches().filter((r) => r !== query));
}

export function readPlaces(): Place[] {
  const parsed = readJson(PLACES_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((p): p is Place => !!p && typeof p.href === "string" && typeof p.title === "string")
    .slice(0, MAX_PLACES);
}

export function savePlace(place: Place) {
  if (!place.href.startsWith("/") || !place.title.trim()) return;
  writeJson(PLACES_KEY, [place, ...readPlaces().filter((p) => p.href !== place.href)].slice(0, MAX_PLACES));
}

/** Pages that aren't places to come back to: the search itself, and sign-in screens. */
export function isTrackablePlace(pathname: string): boolean {
  return !/^\/(admin\/)?search(\/|$)/.test(pathname) && !/^\/(login|no-access|auth|unsubscribe)(\/|$)/.test(pathname);
}

export function readFlag(key: string): boolean {
  return readJson(key) === true;
}

export function writeFlag(key: string, on: boolean) {
  writeJson(key, on);
}
