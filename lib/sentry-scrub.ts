/**
 * Keeps credentials that travel in a URL out of Sentry. A request's address is attached to every error and trace, and
 * three of our addresses are credentials: the calendar subscription feed (`/api/calendar/feed/<token>`, the token is
 * the only thing that identifies the member), the Slack sign-in link (`/auth/slack?token=`) and the email
 * sign-in or unsubscribe links (`?code=`, `?token_hash=`, `?t=`). Sentry only strips cookies and authorization headers,
 * never the URL, so we do it before an event leaves (`beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb`).
 */

const REDACTED = "[redacted]";

/** Query parameters whose value is a credential. */
const SECRET_PARAMS = new Set(["token", "token_hash", "code", "t", "access_token", "refresh_token", "key", "api_key", "apikey", "secret", "sig", "signature", "otp", "state"]);

/** Path prefixes after which the next segment is a credential. */
const SECRET_PATH_PREFIXES = ["/api/calendar/feed/"];

/** The path of an address with credential segments redacted. */
function redactPath(pathname: string): string {
  for (const prefix of SECRET_PATH_PREFIXES) {
    if (pathname.startsWith(prefix) && pathname.length > prefix.length) {
      const rest = pathname.slice(prefix.length);
      const slash = rest.indexOf("/");
      return `${prefix}${REDACTED}${slash === -1 ? "" : rest.slice(slash)}`;
    }
  }
  return pathname;
}

/** `a=1&token=xyz` -> `a=1&token=[redacted]`. Works on a bare query string too. */
export function redactQuery(query: string): string {
  const leading = query.startsWith("?") ? "?" : "";
  const body = leading ? query.slice(1) : query;
  return (
    leading +
    body
      .split("&")
      .map((pair) => {
        const eq = pair.indexOf("=");
        if (eq === -1) return pair;
        let name = pair.slice(0, eq);
        try {
          name = decodeURIComponent(name);
        } catch {
          // keep the raw name
        }
        return SECRET_PARAMS.has(name.toLowerCase()) ? `${pair.slice(0, eq)}=${REDACTED}` : pair;
      })
      .join("&")
  );
}

/** An absolute or relative address with credential path segments and query values redacted. */
export function redactUrl(url: string): string {
  const hash = url.indexOf("#");
  const base = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? "" : url.slice(hash);
  const q = base.indexOf("?");
  const beforeQuery = q === -1 ? base : base.slice(0, q);
  const query = q === -1 ? "" : redactQuery(base.slice(q));
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(beforeQuery)?.[0] ?? "";
  const path = redactPath(beforeQuery.slice(origin.length));
  // A fragment can carry tokens too (`#access_token=...`).
  const safeFragment = fragment.includes("=") ? `#${redactQuery(fragment.slice(1))}` : fragment;
  return `${origin}${path}${query}${safeFragment}`;
}

interface HasRequest {
  request?: { url?: string; query_string?: unknown };
  breadcrumbs?: { data?: Record<string, unknown> }[];
}

/** For `beforeSend` and `beforeSendTransaction`: the same event with credentials in addresses redacted. */
export function scrubEvent<T extends HasRequest>(event: T): T {
  if (event.request) {
    if (typeof event.request.url === "string") event.request.url = redactUrl(event.request.url);
    if (typeof event.request.query_string === "string") event.request.query_string = redactQuery(event.request.query_string);
  }
  for (const crumb of event.breadcrumbs ?? []) scrubData(crumb.data);
  return event;
}

/** For `beforeBreadcrumb`: navigation and fetch breadcrumbs name addresses (`url`, `from`, `to`). */
export function scrubBreadcrumb<T extends { data?: Record<string, unknown> }>(breadcrumb: T): T {
  scrubData(breadcrumb.data);
  return breadcrumb;
}

function scrubData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const field of ["url", "from", "to"]) {
    if (typeof data[field] === "string") data[field] = redactUrl(data[field]);
  }
}
