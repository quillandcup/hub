import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import appConfig from '../config/app'
import { CSP_HEADER, NONCE_HEADER, enforcedCsp, generateNonce } from './lib/csp'

export async function proxy(request: NextRequest) {
  // One enforcing policy with a fresh nonce per request (enforcedCsp in src/lib/csp.ts): scripts and styles, pictures, plugins, base
  // tag, forms, framing, and connection, frame, media and font sources. Next reads the nonce from the request's
  // `content-security-policy` header and puts it on its own scripts and styles; the same policy goes out on the response, and
  // violations go to Sentry (docs/TODO.md, "CSP for scripts and styles"). It must be the only `content-security-policy` header a
  // page request carries: Vercel copies such a header (from next.config.ts too) onto the request, and Next reads the first one it finds.
  const nonce = generateNonce()
  const policy = enforcedCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    imageHosts: appConfig.csp.imageHosts,
    connectHosts: appConfig.csp.connectHosts,
    frameHosts: appConfig.csp.frameHosts,
    mediaHosts: appConfig.csp.mediaHosts,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    dev: process.env.NODE_ENV === 'development',
    // Preview deployments are only opened by CI runs (each on a new host, with Vercel's sign-in redirect on /monitoring): their reports are noise.
    reportViolations: process.env.VERCEL_ENV !== 'preview',
  })
  const response = await updateSession(request, { [NONCE_HEADER]: nonce, [CSP_HEADER]: policy })
  response.headers.set(CSP_HEADER, policy)
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
