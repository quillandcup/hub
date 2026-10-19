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

/** How a stored duration reads. PostgREST serialises intervals as ISO 8601 ("P1Y"). */
export function accessLabel(stored: string | null): string {
  if (stored === null) return "Lifetime";
  const iso: Record<string, string> = { P1Y: "1 year", P6M: "6 months", P3M: "3 months" };
  return iso[stored] ?? stored;
}

/** The option whose label matches a stored duration, if any. */
export function optionIndexFor(stored: string | null): number {
  const label = accessLabel(stored);
  return ACCESS_OPTIONS.findIndex((o) => o.label === label);
}
