import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
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
