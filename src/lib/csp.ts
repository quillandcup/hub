// Content-Security-Policy for every response. Imported by next.config.ts, so it uses relative imports only.
//
// One enforcing policy per request, sent by src/proxy.ts (enforcedCsp): scripts and styles with a per-request nonce, pictures,
// plugins, base tag, forms and framing. Violations are still sent to Sentry, so a host we forgot shows up as a report.
// What is not enforced yet (connection, frame, media and font sources) goes out beside it as Report-Only (reportOnlyCsp), until its
// reports have been read (docs/TODO.md, "CSP for scripts and styles").
// Paths the proxy skips (static files, pictures, the Sentry tunnel, the service worker) get the picture policy (buildCsp) from next.config.ts.

export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
/** The request header that carries the nonce to Server Components (`headers().get(NONCE_HEADER)`). */
export const NONCE_HEADER = "x-nonce";

export interface CspInputs {
  /** The Supabase project URL (storage serves media, covers, emoji, help and changelog pictures). */
  supabaseUrl?: string;
  /** Other origins pictures legitimately load from (config/app.ts `csp.imageHosts`). */
  imageHosts: readonly string[];
  /** The Sentry DSN, whose ingest host also takes CSP reports. Without one, violations are not reported anywhere. */
  sentryDsn?: string;
  /** Report-only for now: where requests may go (config/app.ts `csp.connectHosts`), what may be framed, where media loads from. */
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
 * - `script-src`: anything carrying the nonce, and what a nonced script loads (`'strict-dynamic'`: our own chunks, the Google
 *   Analytics tag, Vercel's scripts), so no host list has to be kept. No `'self'`: a browser that knows `'strict-dynamic'`
 *   ignores `'self'` and every host or scheme source (MDN), so it would do nothing for any browser our members use. A browser
 *   too old for `'strict-dynamic'` reports our chunks as violations instead, which is how it would show up in Sentry
 *   (docs/TODO.md, "CSP for scripts and styles"). Development adds `'unsafe-eval'` (React's debugging needs it; production does not).
 * - `style-src`: our own files and nonced `<style>` tags. Style attributes (`style="..."`, many components set one) cannot carry a
 *   nonce, so `style-src-attr` allows them; that is the weaker part, and it cannot run script.
 * - `worker-src`: session replay and Sentry start workers from `blob:` addresses.
 *
 * Next reads the nonce out of this header on the request and puts it on its own inline scripts and styles, which is why a
 * page that uses it must render per request (the root layout already does: it reads headers and the signed-in member).
 */
function scriptStyleDirectives(nonce: string, dev: boolean): string[] {
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "worker-src 'self' blob:",
  ];
}

/** An https origin's WebSocket twin (Supabase Realtime). */
function websocketOf(origin: string | null): string | null {
  return origin?.startsWith("https://") ? `wss://${origin.slice("https://".length)}` : null;
}

/**
 * The policy a page is held to, sent by src/proxy.ts as `Content-Security-Policy` on the request (Next reads the nonce out of it and
 * puts it on its own scripts and styles) and on the response: scripts and styles with the nonce, and the picture, plugin, base, form
 * and framing directives. It must be the only `content-security-policy` header a page request carries: Vercel copies such a header
 * onto the request, and Next takes the nonce from the first one it finds (docs/TODO.md, "CSP for scripts and styles").
 */
export function enforcedCsp(inputs: CspInputs & { nonce: string; dev?: boolean }): string {
  const directives = [...scriptStyleDirectives(inputs.nonce, inputs.dev ?? false), ...pictureDirectives(inputs)];
  const report = sentryReportUri(inputs.sentryDsn);
  if (report) directives.push(`report-uri ${report}`);
  return directives.join("; ");
}

/**
 * What nothing enforces yet, sent report-only beside the enforced policy: connection, frame, media and font sources. Reports go to
 * Sentry; nothing is blocked by this header. Not sent on the request, so it cannot hide the nonce.
 */
export function reportOnlyCsp(inputs: CspInputs): string {
  const supabase = originOf(inputs.supabaseUrl);
  const sentry = originOf(inputs.sentryDsn);
  const list = (...sources: (string | null | undefined)[]) => [...new Set(sources.filter((v): v is string => Boolean(v)))].join(" ");
  const directives = [
    `connect-src ${list("'self'", supabase, websocketOf(supabase), sentry, ...(inputs.connectHosts ?? []))}`,
    `frame-src ${list("'self'", ...(inputs.frameHosts ?? []))}`,
    `media-src ${list("'self'", "blob:", supabase, ...(inputs.mediaHosts ?? []))}`,
    "font-src 'self' data:",
  ];
  const report = sentryReportUri(inputs.sentryDsn);
  if (report) directives.push(`report-uri ${report}`);
  return directives.join("; ");
}
