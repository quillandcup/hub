// Ids look like `mbr_7Kx2mQ9dFh3N`: a table prefix, an underscore and 12 base58 characters, made by
// the database (`new_id`, docs/SHORT_IDS_PLAN.md). Use this to check an id that arrives from a URL,
// query string or form before it reaches a query. Auth user ids stay uuids and are not checked here.

/** The prefixes of the Tier 1 tables (ids a person can see). */
export const ID_PREFIXES = [
  "mbr", "prkl", "prty", "cmt", "prj", "book", "evt", "prg", "msg",
  "chn", "seg", "bdgt", "crs", "mod", "les", "photo", "file", "media",
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

const BASE58 = "[1-9A-HJ-NP-Za-km-z]{12}";

export function isId(value: string | null | undefined, prefix: IdPrefix): value is string {
  return Boolean(value && new RegExp(`^${prefix}_${BASE58}$`).test(value));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid: an auth user id, or an id the browser made up (analytics, watch segments), never one of ours. */
export const isUuid = (value: string | undefined | null): value is string => Boolean(value && UUID_RE.test(value));

/** Any Tier 1 id, whatever table it is from (for turning a URL segment into "[id]" or "one"). */
export function isAnyId(value: string | null | undefined): boolean {
  return Boolean(value && ID_PREFIXES.some((p) => isId(value, p)));
}
