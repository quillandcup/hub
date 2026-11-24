import { clock } from "@/lib/clock";
import { ORG_TIMEZONE } from "@/lib/config";

/**
 * The year tokens of footer text (docs/product/LANDING_PAGES.md, "Site template"): `{year}` is the current year and `{year:2019}`
 * is "2019–2026", or just the year when 2019 is this year (or later). Resolved each time the footer is drawn, so a copyright line
 * stays current without anyone editing it. Anything else in braces is left as written.
 */
const YEAR_TOKEN = /\{year(?::(\d{4}))?\}/g;

/** The current year in the org's zone (not the server's, which is UTC on Vercel), from the app clock so tests can move it. */
export function currentOrgYear(nowMs: number = clock.now()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, year: "numeric" }).format(new Date(nowMs)));
}

export function resolveYearTokens(text: string, nowMs: number = clock.now()): string {
  if (!text.includes("{year")) return text;
  const year = currentOrgYear(nowMs);
  return text.replace(YEAR_TOKEN, (_all, from?: string) => {
    const start = from ? Number(from) : year;
    return start < year ? `${start}–${year}` : String(year);
  });
}

/** The help line under a footer text field. */
export const FOOTER_YEAR_HELP = "Type {year} for the current year, or {year:2019} for a range such as 2019–2026 that grows each January.";
