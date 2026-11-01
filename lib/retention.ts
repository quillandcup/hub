/**
 * How long personal data in the usage and access logs is kept: the one place the numbers live.
 * The privacy page (`app/(member)/privacy/page.tsx`) prints them, and the scheduled job that enforces
 * them imports the same constants, so what members are told and what the system does cannot drift.
 * The reasoning and the full schedule are in docs/EVENT_LOG.md ("Retention schedule" and "Data inventory").
 *
 * Business records (what a member did in the Hub) have no automatic limit: they are kept until the
 * member asks, so there is deliberately no constant for them.
 */
export const RETENTION = {
  /** The exact IP address and the browser's raw identification string. After this only the approximate place and the type of browser and device remain. */
  rawNetworkDays: 90,
  /** Usage statistics rows (pages, clicks, search, device and screen details). After this only anonymous totals remain. */
  usageMonths: 13,
} as const;
