import { CHANGELOG_AUDIENCES, CHANGELOG_CATEGORIES, CHANGELOG_ENTRIES, type ChangelogAudience, type ChangelogCategory, type ChangelogEntry } from "@/lib/changelog/entries";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isChangelogSlug(value: string): boolean {
  return SLUG.test(value);
}

/** The path of an entry, rebuilt from the validated slug under a fixed prefix; null for anything else. */
export function changelogEntryPath(slug: string): string | null {
  const match = SLUG.exec(slug);
  return match ? `/changelog/${match[0]}` : null;
}

/** Every entry, product and engineering, newest first; entries of the same day keep the order they were written in (later in the file is newer). */
export function listChangelog(entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): ChangelogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.index - a.index)
    .map(({ entry }) => entry);
}

/** What members see (the pages, the digest, the announcements post): the product entries, newest first. Engineering entries are for staff, on the admin Changelog. */
export function listProductChangelog(entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): ChangelogEntry[] {
  return listChangelog(entries).filter((e) => e.audience === "product");
}

/** The `?show=` filter on the What's new page: one category, or null (everything) for no value or one that is not a category. */
export function parseCategoryFilter(value: string | string[] | undefined): ChangelogCategory | null {
  const one = Array.isArray(value) ? value[0] : value;
  return one !== undefined && Object.hasOwn(CHANGELOG_CATEGORIES, one) ? (one as ChangelogCategory) : null;
}

/** Entries of one category, or all of them for null. */
export function filterByCategory(entries: readonly ChangelogEntry[], category: ChangelogCategory | null): ChangelogEntry[] {
  return category ? entries.filter((e) => e.category === category) : [...entries];
}

/** The `?for=` filter on the admin changelog: one audience, or null for both. */
export function parseAudienceFilter(value: string | string[] | undefined): ChangelogAudience | null {
  const one = Array.isArray(value) ? value[0] : value;
  return one !== undefined && Object.hasOwn(CHANGELOG_AUDIENCES, one) ? (one as ChangelogAudience) : null;
}

/** Entries of one audience, or all of them for null. */
export function filterByAudience(entries: readonly ChangelogEntry[], audience: ChangelogAudience | null): ChangelogEntry[] {
  return audience ? entries.filter((e) => e.audience === audience) : [...entries];
}

/**
 * The entries that contain every word of the query (any case) in their title, summary or text. An empty query is no filter.
 * Plain words, not a syntax: what a person types into a search box.
 */
export function searchChangelog(entries: readonly ChangelogEntry[], query: string | string[] | undefined): ChangelogEntry[] {
  const q = (Array.isArray(query) ? query[0] : query) ?? "";
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const text = `${e.title} ${e.summary} ${e.body}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** Any entry by slug, product or engineering (the admin pages show both), or null. */
export function findAnyChangelogEntry(slug: string, entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): ChangelogEntry | null {
  return entries.find((e) => e.slug === slug) ?? null;
}

/** Entries grouped by month, newest first, each group labelled "November 2026" (their order within it is kept). */
export function groupByMonth(entries: readonly ChangelogEntry[]): { month: string; label: string; entries: ChangelogEntry[] }[] {
  const groups = new Map<string, ChangelogEntry[]>();
  for (const e of entries) groups.set(e.date.slice(0, 7), [...(groups.get(e.date.slice(0, 7)) ?? []), e]);
  return [...groups].map(([month, list]) => {
    const [y, m] = month.split("-").map(Number);
    const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
    return { month, label, entries: list };
  });
}

/** A product entry by slug, or null: an engineering entry has no page, so its slug is a 404 like any unknown one. */
export function findChangelogEntry(slug: string, entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): ChangelogEntry | null {
  return entries.find((e) => e.slug === slug && e.audience === "product") ?? null;
}

/** Product entries that shipped after `since` (a YYYY-MM-DD day, exclusive); all of them when null. Newest first. */
export function changelogSince(since: string | null, entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): ChangelogEntry[] {
  return listProductChangelog(entries).filter((e) => since === null || e.date > since);
}

/** Whether an image path belongs to the entry's own folder in public/changelog/, with no way to climb out of it. */
export function isChangelogImagePath(slug: string, src: string): boolean {
  return new RegExp(`^/changelog/${slug}/[a-z0-9][a-z0-9-]*\\.(png|jpe?g|webp|gif)$`).test(src);
}

/** Everything wrong with a set of entries, for the test that guards the file; empty when it is fine. */
export function validateChangelog(entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const where = `"${e.slug}"`;
    if (!SLUG.test(e.slug)) problems.push(`${where}: slug must be lowercase words and hyphens`);
    if (seen.has(e.slug)) problems.push(`${where}: duplicate slug`);
    seen.add(e.slug);
    if (!DATE.test(e.date) || Number.isNaN(Date.parse(e.date))) problems.push(`${where}: date must be YYYY-MM-DD`);
    if (!(e.category in CHANGELOG_CATEGORIES)) problems.push(`${where}: unknown category`);
    if (!(e.audience in CHANGELOG_AUDIENCES)) problems.push(`${where}: unknown audience`);
    if (e.major && e.audience !== "product") problems.push(`${where}: only a product entry can be major`);
    // An engineering entry has no page, digest or post to show a screenshot in.
    if (e.audience === "engineering" && (e.image || /!\[[^\]]*\]\(/.test(e.body))) problems.push(`${where}: an engineering entry has no screenshots`);
    if (!e.title.trim()) problems.push(`${where}: empty title`);
    if (!e.summary.trim()) problems.push(`${where}: empty summary`);
    if (/[*_`#\[\]]/.test(e.summary)) problems.push(`${where}: summary is plain text, no markdown`);
    if (!e.body.trim()) problems.push(`${where}: empty body`);
    if (e.image && !isChangelogImagePath(e.slug, e.image.src)) problems.push(`${where}: image must be /changelog/${e.slug}/<file>`);
    if (e.image && !e.image.alt.trim()) problems.push(`${where}: image needs alt text`);
    if (e.audience === "product") for (const m of e.body.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)) {
      if (!isChangelogImagePath(e.slug, m[1])) problems.push(`${where}: body image ${m[1]} must be /changelog/${e.slug}/<file>`);
    }
  }
  return problems;
}
