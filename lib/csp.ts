// Content-Security-Policy for every response. Imported by next.config.ts, so it uses relative imports only.
//
// Enforcing since 2026-11-17, after a week of Report-Only reports showed one missing picture host (now in app.config.ts).
// Violations are still sent to Sentry, so a picture host we forgot shows up as a report.
// Scripts and styles are covered by a second policy with a per-request nonce (scriptStyleCsp), sent by proxy.ts in
// report-only mode first (docs/TODO.md, "CSP for scripts and styles").

export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
/** The request header that carries the nonce to Server Components (`headers().get(NONCE_HEADER)`). */
export const NONCE_HEADER = "x-nonce";

export interface CspInputs {
  /** The Supabase project URL (storage serves media, covers, emoji, help and changelog pictures). */
  supabaseUrl?: string;
  /** Other origins pictures legitimately load from (app.config.ts `csp.imageHosts`). */
  imageHosts: readonly string[];
  /** The Sentry DSN, whose ingest host also takes CSP reports. Without one, violations are not reported anywhere. */
  sentryDsn?: string;
  /** Report-only for now: where requests may go (app.config.ts `csp.connectHosts`), what may be framed, where media loads from. */
  connectHosts?: readonly string[];
  frameHosts?: readonly string[];
  mediaHosts?: readonly string[];
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

/** The picture, plugin, base, form and framing directives (what is enforced). */
function pictureDirectives({ supabaseUrl, imageHosts }: CspInputs): string[] {
  const images = ["'self'", "data:", "blob:", originOf(supabaseUrl), ...imageHosts].filter((v): v is string => Boolean(v));
  return [
    `img-src ${[...new Set(images)].join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];
}

export function buildCsp(inputs: CspInputs): string {
  const directives = pictureDirectives(inputs);
  const report = sentryReportUri(inputs.sentryDsn);
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

/** A fresh, unguessable value for one request (base64 of a random UUID, the shape Next's documentation uses). */
export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * The script and style half of the policy, for one request.
 *
 * - `script-src`: our own files and anything carrying the nonce. `'strict-dynamic'` lets a nonced script load others (the Google
 *   Analytics tag, Vercel's scripts), so no host list has to be kept; browsers that know it ignore `'self'` and the hosts.
 *   Development adds `'unsafe-eval'` (React's debugging needs it; production does not).
 * - `style-src`: our own files and nonced `<style>` tags. Style attributes (`style="..."`, many components set one) cannot carry a
 *   nonce, so `style-src-attr` allows them; that is the weaker part, and it cannot run script.
 * - `worker-src`: session replay and Sentry start workers from `blob:` addresses.
 *
 * Next reads the nonce out of this header on the request and puts it on its own inline scripts and styles, which is why a
 * page that uses it must render per request (the root layout already does: it reads headers and the signed-in member).
 */
function scriptStyleDirectives(nonce: string, dev: boolean): string[] {
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "worker-src 'self' blob:",
  ];
}

export function scriptStyleCsp({ nonce, sentryDsn, dev = false }: { nonce: string; sentryDsn?: string; dev?: boolean }): string {
  const directives = scriptStyleDirectives(nonce, dev);
  const report = sentryReportUri(sentryDsn);
  if (report) directives.push(`report-uri ${report}`);
  return directives.join("; ");
}

/** An https origin's WebSocket twin (Supabase Realtime). */
function websocketOf(origin: string | null): string | null {
  return origin?.startsWith("https://") ? `wss://${origin.slice("https://".length)}` : null;
}

/**
 * The whole policy, sent report-only by proxy.ts: scripts and styles (with the nonce), everything the enforced picture policy says
 * (so violations of it are reported even though pages enforce it through a meta tag, which cannot report), and connection, frame,
 * media and font sources, which nothing enforces yet. Reports go to Sentry; nothing is blocked by this header.
 */
export function reportOnlyCsp(inputs: CspInputs & { nonce: string; dev?: boolean }): string {
  const supabase = originOf(inputs.supabaseUrl);
  const sentry = originOf(inputs.sentryDsn);
  const list = (...sources: (string | null | undefined)[]) => [...new Set(sources.filter((v): v is string => Boolean(v)))].join(" ");
  const directives = [
    ...scriptStyleDirectives(inputs.nonce, inputs.dev ?? false),
    ...pictureDirectives(inputs),
    `connect-src ${list("'self'", supabase, websocketOf(supabase), sentry, ...(inputs.connectHosts ?? []))}`,
    `frame-src ${list("'self'", ...(inputs.frameHosts ?? []))}`,
    `media-src ${list("'self'", "blob:", supabase, ...(inputs.mediaHosts ?? []))}`,
    "font-src 'self' data:",
  ];
  const report = sentryReportUri(inputs.sentryDsn);
  if (report) directives.push(`report-uri ${report}`);
  return directives.join("; ");
}

/**
 * The enforcing policy as a `<meta http-equiv>` tag for pages (app/layout.tsx), for now. Why not the header: Next takes the script
 * nonce from the request's `content-security-policy` header, and on Vercel any such header, from next.config.ts or from the proxy,
 * is copied onto the request and hides the nonce that sits in the report-only one (diagnosed 2026-11-18, docs/TODO.md, "CSP for
 * scripts and styles"). A meta tag has no such side effect. It cannot carry `frame-ancestors` (X-Frame-Options says the same) or
 * `report-uri`, so those are left out. Goes away when one header carries the picture and script policies.
 */
export function buildMetaCsp(inputs: CspInputs): string {
  return buildCsp({ ...inputs, sentryDsn: undefined })
    .split("; ")
    .filter((d) => !d.startsWith("frame-ancestors"))
    .join("; ");
}
