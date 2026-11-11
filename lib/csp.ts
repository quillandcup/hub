// Content-Security-Policy for every response. Imported by next.config.ts, so it uses relative imports only.
//
// Report-Only for now: the browser tells us what the policy would have blocked and blocks nothing. Once the reports
// are clean the same value becomes the enforcing `Content-Security-Policy` (docs/TODO.md, "Enforce the Content-Security-Policy").
// Scripts and styles are not covered yet: that needs per-request nonces (docs/TODO.md, "Script and style nonces").

export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

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
