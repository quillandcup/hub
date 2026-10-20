const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROUTE_LENGTH = 120;

/**
 * A path as a route template: query and hash dropped, and any segment that is an id (a UUID, a
 * number, or a long token with a digit in it) replaced by `[id]`. `/prickles/3f2a…` and
 * `/members/42` become `/prickles/[id]` and `/members/[id]`, so usage groups by page and a
 * person's id never lands in an event. Null for anything that isn't a same-origin path.
 */
export function templateRoute(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
  const pathname = path.split(/[?#]/, 1)[0];
  const segments = pathname.split("/").map((segment) => {
    if (!segment) return segment;
    if (UUID.test(segment) || /^\d+$/.test(segment)) return "[id]";
    if (segment.length >= 8 && /\d/.test(segment) && /^[\w-]+$/.test(segment)) return "[id]";
    return segment;
  });
  const route = segments.join("/") || "/";
  return route.length > MAX_ROUTE_LENGTH ? route.slice(0, MAX_ROUTE_LENGTH) : route;
}
