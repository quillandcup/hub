import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, NONCE_HEADER, generateNonce, scriptStyleCsp } from './lib/csp'

export async function proxy(request: NextRequest) {
  // The script and style policy carries a fresh nonce per request. Next reads it from the request's policy header and puts
  // it on its own scripts and styles; the same policy goes out on the response. Report-only until Sentry shows no
  // violations (docs/TODO.md, "CSP for scripts and styles").
  const nonce = generateNonce()
  const policy = scriptStyleCsp({
    nonce,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    dev: process.env.NODE_ENV === 'development',
  })
  // Next takes the nonce from the request's `content-security-policy` header before the report-only one. On Vercel that header
  // can already hold the enforcing policy from next.config.ts (no script directive, so no nonce), and then no script got one
  // (production reports, 2026-11-18). The request copy is only for Next to read; what the browser enforces is the response.
  const response = await updateSession(request, { [NONCE_HEADER]: nonce, [CSP_HEADER]: policy, [CSP_REPORT_ONLY_HEADER]: policy })
  response.headers.set(CSP_REPORT_ONLY_HEADER, policy)
  return response
}
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - monitoring (Sentry tunnel route, bypasses ad-blockers)
     * - sw.js (the Web Push service worker; the browser fetches it without a session, and a
     *   redirect to /login would make registration fail)
     * - manifest.webmanifest (browsers fetch it without cookies, so a redirect to /login breaks it)
     */
    '/((?!_next/static|_next/image|favicon.ico|monitoring|sw\\.js$|manifest\\.webmanifest$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
