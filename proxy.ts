import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import appConfig from './app.config'
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, NONCE_HEADER, buildCsp, generateNonce, scriptStyleCsp } from './lib/csp'

export async function proxy(request: NextRequest) {
  // The script and style policy (scriptStyleCsp in lib/csp.ts, with a per-request nonce) is built and tested but not sent:
  // on Vercel Next's own scripts did not get the nonce, so every script was reported (docs/TODO.md, "CSP for scripts and
  // styles"). The root layout still passes a nonce to our inline scripts when this proxy hands one over (NONCE_HEADER).
  //
  // EXPERIMENT (docs/TODO.md, "CSP for scripts and styles"): on Vercel the request's `content-security-policy` is the one from
  // next.config.ts, whatever the proxy overrides, so Next found no nonce in it. So: next.config.ts no longer sends it on pages,
  // the nonce policy goes on the request as the *report-only* header (Next reads that one when there is no other), and the
  // enforcing policy goes out from here on the response. Nothing about scripts is sent to the browser. The layout records what
  // it saw (data-csp-seen); remove that once this is read.
  const nonce = generateNonce()
  const policy = scriptStyleCsp({ nonce })
  const response = await updateSession(request, { [NONCE_HEADER]: nonce, [CSP_REPORT_ONLY_HEADER]: policy })
  response.headers.set(
    CSP_HEADER,
    buildCsp({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      imageHosts: appConfig.csp.imageHosts,
      sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    }),
  )
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
