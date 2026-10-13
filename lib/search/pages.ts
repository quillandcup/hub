import type { FeatureKey } from "@/lib/features";
import { SITE_PAGES, pageEnabled } from "@/lib/site-pages";

/** A page for the "Pages" kind of universal search; the list itself is lib/site-pages.ts. */
export interface PageHit {
  title: string;
  /** "Settings" for a member page; "Admin · Data Health" for an admin one. */
  section: string;
  href: string;
}

/** Every word must appear in the title, section or a keyword. Title matches sort first. */
export function matchPages(words: string[], opts: { isActingAsAdmin: boolean; features: readonly FeatureKey[] }): PageHit[] {
  const needles = words.map((w) => w.toLowerCase());
  const scored: { hit: PageHit; rank: number }[] = [];
  for (const page of SITE_PAGES) {
    if ((page.audience === "admin" && !opts.isActingAsAdmin) || !pageEnabled(page, opts.features)) continue;
    const section = page.audience === "admin" ? `Admin · ${page.section}` : page.section;
    const title = page.title.toLowerCase();
    const rest = `${section} ${(page.keywords ?? []).join(" ")}`.toLowerCase();
    if (!needles.every((n) => title.includes(n) || rest.includes(n))) continue;
    scored.push({ hit: { title: page.title, section, href: page.href }, rank: needles.every((n) => title.includes(n)) ? 0 : 1 });
  }
  return scored.sort((a, b) => a.rank - b.rank).map((s) => s.hit);
}
