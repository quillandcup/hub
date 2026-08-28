import { createServerClient } from '@supabase/ssr'
import { NextResponse, after, type NextRequest } from 'next/server'
import { withTimeout, AUTH_CHECK_TIMEOUT_MS } from '@/lib/with-timeout'
import { getSessionIdFromAccessToken } from '@/lib/supabase/session-claims'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // GoTrue records auth.sessions.user_agent/ip from whatever hit its own
  // endpoint — since this refresh call originates from our server, not the
  // browser, forward the real request's headers so Active Sessions shows
  // the member's actual device/location rather than Vercel's runtime.
  const userAgent = request.headers.get('user-agent')
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
      global: {
        headers: {
          ...(userAgent ? { 'User-Agent': userAgent } : {}),
          ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
        },
      },
    }
  )

  // getUser() here is load-bearing beyond the redirect below: it's what makes
  // @supabase/ssr refresh an expiring access token and persist the new cookie
  // via the setAll handler above. Server Components can read cookies but
  // can't write them, so if this middleware didn't do it, tokens would never
  // get refreshed-and-persisted and sessions would degrade over time. The
  // /login redirect further down is a secondary fast-path only -- the real
  // gate is each protected layout's own uncapped getUser() recheck.
  let user = null
  let sessionId: string | null = null
  let authCheckTimedOut = false
  try {
    const { data } = await withTimeout(supabase.auth.getUser(), AUTH_CHECK_TIMEOUT_MS)
    user = data.user
    if (user) {
      // getSession() reads the already-parsed cookie session (no extra
      // network round trip) — getUser() above is what verifies the token.
      const { data: sessionData } = await supabase.auth.getSession()
      if (sessionData.session?.access_token) {
        sessionId = getSessionIdFromAccessToken(sessionData.session.access_token)
      }
    }
  } catch {
    // Supabase unreachable or too slow to respond within our short budget --
    // NOT the same thing as "no session". Don't force the /login redirect
    // below on this: app/(member)/layout.tsx and app/(admin)/layout.tsx each
    // independently re-run their own uncapped getUser() check right after
    // and will redirect correctly if the session really is gone. Treating a
    // timeout as "logged out" here was kicking users with perfectly valid
    // sessions to /login on ordinary Supabase latency blips.
    authCheckTimedOut = true
  }

  const { pathname } = request.nextUrl

  // Log access events for signed-in users (login/session history, admin-only
  // view). Skip Next.js prefetch requests (Link hover, etc.) — those aren't
  // real visits and would pollute both the page trail and session gaps.
  const isPrefetch =
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('sec-purpose')?.includes('prefetch')
  if (user && !isPrefetch) {
    const userId = user.id
    const eventSessionId = sessionId
    after(async () => {
      try {
        await supabase.from('access_events').insert({
          user_id: userId,
          path: pathname,
          is_page: !pathname.startsWith('/api/'),
          session_id: eventSessionId,
        })
      } catch {
        // Best-effort logging — never break the request over this.
      }
    })
  }

  // Public routes — no auth required
  // API routes handle their own auth via requireAdmin/createApiAuth
  const isPublic =
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/')

  if (!user && !isPublic && !authCheckTimedOut) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
