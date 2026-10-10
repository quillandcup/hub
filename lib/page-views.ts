/** Where the client reports page views (components/PageViewTracker.tsx); see app/api/track/page-view. */
export const PAGE_VIEW_PATH = "/api/track/page-view";

const MAX_PATH_LENGTH = 300;

/**
 * A path the tracker may record: same-origin, absolute, never an API route. Anything else is
 * dropped, so a forged request can't fill the trail with arbitrary text.
 */
export function normalizeTrackedPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.length > MAX_PATH_LENGTH) return null;
  if (value === "/api" || value.startsWith("/api/")) return null;
  if (/[\s\\?#]/.test(value)) return null;
  return value;
}
