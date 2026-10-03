/**
 * Helpers for cross-linking writing progress entries with the prickles they were written in
 * (writing_progress_entries.prickle_id). Pure functions only -- the queries live in
 * app/(member)/projects/actions.ts.
 */

export interface PrickleOption {
  id: string;
  label: string;
  startTime: string;
  /** The member has an attendance record for this prickle. */
  attended: boolean;
}

/** Calendar date (YYYY-MM-DD) of an instant in the given IANA timezone. */
export function localDateOf(isoTimestamp: string, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoTimestamp));
}

/** e.g. "Tue, Oct 1 · 9:00 AM · Morning Sprint with Jo" -- date and time in the viewer's timezone. */
export function formatPrickleLabel(
  prickle: { startTime: string; typeName: string | null; hostName: string | null },
  timeZone: string
): string {
  const start = new Date(prickle.startTime);
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(
    start
  );
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(start);
  const name = prickle.typeName ?? "Prickle";
  const host = prickle.hostName ? ` with ${prickle.hostName.split(" ")[0]}` : "";
  return `${day} · ${time} · ${name}${host}`;
}

/** Attended prickles first, then by start time. */
export function sortPrickleOptions(options: PrickleOption[]): PrickleOption[] {
  return [...options].sort(
    (a, b) => Number(b.attended) - Number(a.attended) || a.startTime.localeCompare(b.startTime)
  );
}

/**
 * The prickle a new entry on this date should default to: the one prickle the member attended
 * that day. With none or several attended there's no safe guess, so the member picks.
 */
export function defaultPrickleId(options: PrickleOption[]): string | null {
  const attended = options.filter((o) => o.attended);
  return attended.length === 1 ? attended[0].id : null;
}
