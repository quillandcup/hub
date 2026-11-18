import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import { CSP_REPORT_ONLY_HEADER, NONCE_HEADER, generateNonce, scriptStyleCsp } from './lib/csp'

export async function proxy(request: NextRequest) {
  // The script and style policy (scriptStyleCsp in lib/csp.ts, with a per-request nonce) is built and tested but not sent:
  // on Vercel Next's own scripts did not get the nonce, so every script was reported (docs/TODO.md, "CSP for scripts and
  // styles"). The root layout still passes a nonce to our inline scripts when this proxy hands one over (NONCE_HEADER).
  //
  // The script and style policy carries a fresh nonce per request. Next reads it from the request's policy header and puts it on
  // its own scripts and styles; the same policy goes out on the response, report-only for now (docs/TODO.md, "CSP for scripts and
  // styles"). It must be the only policy header here: Vercel copies a `content-security-policy` header onto the request, and Next
  // reads that one first and finds no nonce in it. The enforcing picture policy for pages is a meta tag (buildMetaCsp, app/layout.tsx).
  const nonce = generateNonce()
  const policy = scriptStyleCsp({
    nonce,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    dev: process.env.NODE_ENV === 'development',
  })
  const response = await updateSession(request, { [NONCE_HEADER]: nonce, [CSP_REPORT_ONLY_HEADER]: policy })
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
