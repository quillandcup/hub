/**
 * When a tab's deployment stops being served to it. Vercel keeps answering a tab's requests from the deployment
 * it was opened on for the project's Skew Protection maximum age, counted from that deployment's creation
 * (vercel-project-config.yml). After that the tab's requests land on the live deployment, and a server action it
 * sends is refused. The build records its own time and the maximum age (next.config.ts), so the page can say so
 * a little before.
 */

/** How long before the deadline the tab is told, so there is time to finish and submit what is on the page. */
export const WARN_BEFORE_MS = 12 * 60 * 60 * 1000;

/**
 * Whether this page's build is within `WARN_BEFORE_MS` of (or past) the deadline. A build time or maximum age that
 * is missing or not a number (a local build, a test) never warns. It can't tell whether a newer deployment exists,
 * only that this one is old enough to matter: a tab on the live deployment that is this old gets the notice too,
 * which we accept because deploys land many times a week.
 */
export function isNearSkewDeadline(now: number, buildTime: string | undefined, maxAgeSeconds: string | undefined, warnBeforeMs = WARN_BEFORE_MS): boolean {
  const built = buildTime ? Date.parse(buildTime) : NaN;
  const maxAgeMs = Number(maxAgeSeconds) * 1000;
  if (!Number.isFinite(built) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  return now >= built + maxAgeMs - warnBeforeMs;
}
