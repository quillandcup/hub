/**
 * Access lengths a course can be given. `value` is what the processing route stores (a Postgres
 * interval); null is lifetime. The choice is always explicit: there is no default.
 */
export const ACCESS_OPTIONS: { label: string; value: string | null }[] = [
  { label: "Lifetime", value: null },
  { label: "1 year", value: "1 year" },
  { label: "6 months", value: "6 months" },
  { label: "3 months", value: "3 months" },
];

/**
 * How a stored duration reads. Depending on how it comes back from the database an interval is
 * ISO 8601 ("P1Y") or Postgres's own text ("1 year", "6 mons"); both read the same here.
 */
export function accessLabel(stored: string | null): string {
  if (stored === null) return "Lifetime";
  const known: Record<string, string> = {
    P1Y: "1 year",
    "1 year": "1 year",
    P6M: "6 months",
    "6 mons": "6 months",
    "6 months": "6 months",
    P3M: "3 months",
    "3 mons": "3 months",
    "3 months": "3 months",
  };
  return known[stored] ?? stored;
}

/** The option whose label matches a stored duration, if any. */
export function optionIndexFor(stored: string | null): number {
  const label = accessLabel(stored);
  return ACCESS_OPTIONS.findIndex((o) => o.label === label);
}
