// Content-Security-Policy for every response. Imported by next.config.ts, so it uses relative imports only.
//
// Enforcing since 2026-11-17, after a week of Report-Only reports showed one missing picture host (now in app.config.ts).
// Violations are still sent to Sentry, so a picture host we forgot shows up as a report.
// Scripts and styles are not covered yet: that needs per-request nonces (docs/TODO.md, "Script and style nonces").

export const CSP_HEADER = "Content-Security-Policy";

export interface CspInputs {
  /** The Supabase project URL (storage serves media, covers, emoji, help and changelog pictures). */
  supabaseUrl?: string;
  /** Other origins pictures legitimately load from (app.config.ts `csp.imageHosts`). */
  imageHosts: readonly string[];
  /** The Sentry DSN, whose ingest host also takes CSP reports. Without one, violations are not reported anywhere. */
  sentryDsn?: string;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Where Sentry wants CSP violation reports for a project: its ingest host's `/api/<project>/security/` with the public key.
 * Everything in a DSN is public by design (a write-only ingest address). Reports carry the page address and the blocked
 * origin, never page content or cookies.
 */
export function sentryReportUri(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, "").split("/").pop();
    if (!u.username || !project) return null;
    return `${u.protocol}//${u.host}/api/${project}/security/?sentry_key=${u.username}`;
  } catch {
    return null;
  }
}

export function buildCsp({ supabaseUrl, imageHosts, sentryDsn }: CspInputs): string {
  const images = ["'self'", "data:", "blob:", originOf(supabaseUrl), ...imageHosts].filter((v): v is string => Boolean(v));
  const directives = [
    `img-src ${[...new Set(images)].join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];
  const report = sentryReportUri(sentryDsn);
  if (report) directives.push(`report-uri ${report}`);
  return directives.join("; ");
}

/**
 * The other protections every response carries. `frame-ancestors` in the policy covers framing in current browsers;
 * X-Frame-Options says the same to older ones. The Hub uses no camera, microphone, location or payment request.
 */
export const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];
