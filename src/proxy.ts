import { NextResponse, type NextRequest } from 'next/server'
import { continueSignedOut, updateSession } from './lib/supabase/middleware'
import { decideRoute, resolveLandingRoute } from './lib/root-routing'
import { isPublishedAddress } from './lib/landing/published-addresses'
import { PUBLIC_SITE_LIVE } from './lib/config'
import appConfig from '../config/app'
import { CSP_HEADER, NONCE_HEADER, enforcedCsp, generateNonce } from './lib/csp'

export async function proxy(request: NextRequest) {
  // Host first (src/lib/root-routing.ts): www goes to the root host, the root host sends what the Hub doesn't serve to Kajabi and
  // signed-in paths to the app host. The app host and previews get "pass" and everything below runs as before.
  const decided = decideRoute({
    host: request.headers.get('host') ?? '',
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  })
  // On the root host a single segment that is spelled like a page address may be a published landing page (/<slug>, served from
  // /p/<slug>): the lookup (cached, bounded, never throws) decides, and anything not published gets what it got without it.
  const route = decided.action === 'landing-page' ? await resolveLandingRoute(decided, isPublishedAddress) : decided
  if (route.action === 'redirect') return NextResponse.redirect(route.location, route.status)
  // next.config.ts sets skipTrailingSlashRedirect so that Next doesn't 308 "/products/x/" to "/products/x" before this proxy can send it to
  // Kajabi with its slash intact. For everything the Hub serves, this keeps what Next did itself: a trailing slash is dropped (308).
  // Only once the public site is live (config/app.ts publicSiteLive); before, next.config.ts leaves Next's own redirect on.
  if (PUBLIC_SITE_LIVE && request.nextUrl.pathname.length > 1 && request.nextUrl.pathname.endsWith('/')) {
    // Built from text: setting pathname on a clone of nextUrl puts the slash back.
    const { origin, pathname, search } = request.nextUrl
    return NextResponse.redirect(new URL(`${pathname.replace(/\/+$/, '') || '/'}${search}`, origin), 308)
  }
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
  })
  const headers = { [NONCE_HEADER]: nonce, [CSP_HEADER]: policy }
  const response =
    route.host === 'root'
      ? continueSignedOut(request, headers, route.action === 'rewrite' ? route.pathname : undefined)
      : await updateSession(request, headers)
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
