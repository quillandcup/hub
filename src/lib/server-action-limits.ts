/**
 * The most a Server Action request body may weigh (`experimental.serverActions.bodySizeLimit` in next.config.ts).
 * Next's default is 1 MB. The landing page builder lets a page be up to MAX_LANDING_BYTES (2 MB of characters, src/lib/landing/json-transfer.ts)
 * and its save, publish, import and create-from-JSON actions carry the page in the body, so the default made a page between
 * 1 and 2 MB fail in the transport (Sentry HUB-23) before our own "too big" check ran. Twice the page cap leaves room for
 * multi-byte characters and the escaping of JSON inside the request.
 * Keep it below Vercel's own 4.5 MB request limit for functions, which would otherwise answer first with a bare 413.
 * Every other action that moves a file uses a signed upload, so none needs more. tests/lib/server-action-limits.test.ts guards both bounds.
 * Plain module with no imports: next.config.ts reads it.
 */
export const SERVER_ACTION_BODY_LIMIT_BYTES = 4_000_000;
