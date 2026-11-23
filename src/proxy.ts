import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import appConfig from '../config/app'
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, NONCE_HEADER, enforcedCsp, generateNonce, reportOnlyCsp } from './lib/csp'

export async function proxy(request: NextRequest) {
  // One enforcing policy with a fresh nonce per request (enforcedCsp in src/lib/csp.ts): scripts and styles, pictures, plugins, base
  // tag, forms and framing. Next reads the nonce from the request's `content-security-policy` header and puts it on its own scripts
  // and styles; the same policy goes out on the response, and violations go to Sentry (docs/TODO.md, "CSP for scripts and styles").
  // It must be the only `content-security-policy` header a page request carries: Vercel copies such a header (from next.config.ts too)
  // onto the request, and Next reads the first one it finds. What is not enforced yet (connection, frame, media and font sources)
  // is the Report-Only header, sent on the response only.
  const nonce = generateNonce()
  const sources = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    imageHosts: appConfig.csp.imageHosts,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  }
  const policy = enforcedCsp({ ...sources, nonce, dev: process.env.NODE_ENV === 'development' })
  const reportOnly = reportOnlyCsp({
    ...sources,
    connectHosts: appConfig.csp.connectHosts,
    frameHosts: appConfig.csp.frameHosts,
    mediaHosts: appConfig.csp.mediaHosts,
  })
  const response = await updateSession(request, { [NONCE_HEADER]: nonce, [CSP_HEADER]: policy })
  response.headers.set(CSP_HEADER, policy)
  response.headers.set(CSP_REPORT_ONLY_HEADER, reportOnly)
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
