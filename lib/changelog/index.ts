import { CHANGELOG_CATEGORIES, CHANGELOG_ENTRIES, type ChangelogEntry } from "@/lib/changelog/entries";

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

/** Newest first; entries of the same day keep the order they were written in (later in the file is newer). */
export function listChangelog(entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): ChangelogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.index - a.index)
    .map(({ entry }) => entry);
}

export function findChangelogEntry(slug: string, entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): ChangelogEntry | null {
  return entries.find((e) => e.slug === slug) ?? null;
}

/** Entries that shipped after `since` (a YYYY-MM-DD day, exclusive); all of them when null. Newest first. */
export function changelogSince(since: string | null, entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): ChangelogEntry[] {
  return listChangelog(entries).filter((e) => since === null || e.date > since);
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
    if (!e.title.trim()) problems.push(`${where}: empty title`);
    if (!e.summary.trim()) problems.push(`${where}: empty summary`);
    if (/[*_`#\[\]]/.test(e.summary)) problems.push(`${where}: summary is plain text, no markdown`);
    if (!e.body.trim()) problems.push(`${where}: empty body`);
    if (e.image && !isChangelogImagePath(e.slug, e.image.src)) problems.push(`${where}: image must be /changelog/${e.slug}/<file>`);
    if (e.image && !e.image.alt.trim()) problems.push(`${where}: image needs alt text`);
    for (const m of e.body.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)) {
      if (!isChangelogImagePath(e.slug, m[1])) problems.push(`${where}: body image ${m[1]} must be /changelog/${e.slug}/<file>`);
    }
  }
  return problems;
}

/** The text of CHANGELOG.md, generated from the entries (`pnpm changelog:generate`). */
export function renderChangelogMarkdown(entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES): string {
  const lines = [
    "# Changelog",
    "",
    "<!-- Generated from lib/changelog/entries.ts by `pnpm changelog:generate`. Edit the entries, not this file. -->",
    "",
    "What's new and fixed in the Hedgie Hub, newest first.",
  ];
  for (const e of listChangelog(entries)) {
    lines.push("", `## ${e.date} · ${CHANGELOG_CATEGORIES[e.category]}: ${e.title}`, "", e.summary);
  }
  return lines.join("\n") + "\n";
}
