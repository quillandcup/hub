/**
 * Options for the Supabase sign-in cookies, shared by the browser, server and proxy clients so they cannot disagree.
 *
 * `Secure` keeps the browser from ever sending the session over plain HTTP; it is off only in local development, which
 * runs on http://localhost (every deployed build, previews included, is served over HTTPS). The library's own defaults
 * stay: path `/`, `SameSite=Lax`, no `Domain` (so the cookie belongs to the exact host, never its subdomains) and
 * a 400 day lifetime that the session's own expiry limits.
 *
 * Not `HttpOnly`: the browser client reads the session from the cookie for chat Realtime, direct uploads and sign-in.
 * See docs/TODO.md, "Make the sign-in cookies HttpOnly".
 */
export const SUPABASE_COOKIE_OPTIONS = {
  secure: process.env.NODE_ENV === "production",
} as const;
