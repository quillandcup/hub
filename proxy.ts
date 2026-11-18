import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import appConfig from './app.config'
import { CSP_REPORT_ONLY_HEADER, NONCE_HEADER, generateNonce, reportOnlyCsp } from './lib/csp'

export async function proxy(request: NextRequest) {
  // One report-only policy with a fresh nonce per request (reportOnlyCsp in lib/csp.ts): scripts and styles, pictures, and
  // connection, frame, media and font sources. Next reads the nonce from the request's policy header and puts it on its own scripts
  // and styles; the same policy goes out on the response, and violations go to Sentry (docs/TODO.md, "CSP for scripts and styles").
  // It must be the only policy header here: Vercel copies a `content-security-policy` header onto the request, and Next reads that
  // one first and finds no nonce in it. The enforced picture policy for pages is therefore a meta tag (buildMetaCsp, app/layout.tsx),
  // which cannot report, so this header repeats those directives to get their violations reported.
  const nonce = generateNonce()
  const policy = reportOnlyCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    imageHosts: appConfig.csp.imageHosts,
    connectHosts: appConfig.csp.connectHosts,
    frameHosts: appConfig.csp.frameHosts,
    mediaHosts: appConfig.csp.mediaHosts,
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
