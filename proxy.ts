import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import { CSP_HEADER, NONCE_HEADER, generateNonce, scriptStyleCsp } from './lib/csp'

export async function proxy(request: NextRequest) {
  // The script and style policy (scriptStyleCsp in lib/csp.ts, with a per-request nonce) is built and tested but not sent:
  // on Vercel Next's own scripts did not get the nonce, so every script was reported (docs/TODO.md, "CSP for scripts and
  // styles"). The root layout still passes a nonce to our inline scripts when this proxy hands one over (NONCE_HEADER).
  //
  // TEMPORARY DIAGNOSTIC (docs/TODO.md, "CSP for scripts and styles"): hand Next a nonce policy on the request only, send nothing to
  // the browser, and let the layout record which policy headers it saw (app/layout.tsx, data-csp-seen). Remove after reading it.
  const nonce = generateNonce()
  const policy = scriptStyleCsp({ nonce })
  return await updateSession(request, { [NONCE_HEADER]: nonce, [CSP_HEADER]: policy })
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
