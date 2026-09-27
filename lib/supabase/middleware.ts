import { createServerClient } from '@supabase/ssr'
import { NextResponse, after, type NextRequest } from 'next/server'
import { withTimeout, AUTH_CHECK_TIMEOUT_MS } from '@/lib/with-timeout'
import { getAppRoleFromAccessToken, getSessionIdFromAccessToken } from '@/lib/supabase/session-claims'
import { ADMIN_NO_ACCESS_PATH, isAdminPath } from '@/lib/admin-paths'

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
  // gate is each protected layout's own recheck via getCurrentUser()
  // (lib/auth.ts). That recheck verifies the JWT locally with getClaims(), so
  // this is also the one place per request that asks Supabase Auth whether
  // the session is still live: when it isn't, getUser() clears the auth
  // cookies through setAll() above, on the request forwarded downstream too.
  let user = null
  let sessionId: string | null = null
  // undefined = no app_role claim in the token (see getAppRoleFromAccessToken)
  let roleClaim: string | null | undefined = undefined
  let authCheckTimedOut = false
  try {
    const { data } = await withTimeout(supabase.auth.getUser(), AUTH_CHECK_TIMEOUT_MS)
    user = data.user
    if (user) {
      // getSession() reads the already-parsed cookie session (no extra
      // network round trip) — getUser() above is what verified this token
      // (after refreshing it if it had expired), so its claims are trusted
      // as much as the user it returned.
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (accessToken) {
        sessionId = getSessionIdFromAccessToken(accessToken)
        roleClaim = getAppRoleFromAccessToken(accessToken)
      }
    }
  } catch {
    // Supabase unreachable or too slow to respond within our short budget --
    // NOT the same thing as "no session". Don't force the /login redirect
    // below on this: app/(member)/layout.tsx and app/(admin)/layout.tsx each
    // independently re-run their own auth check (getCurrentUser()) right after
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

  // Admin area: optimistic role check so a signed-in non-admin is sent to
  // /no-access (see lib/admin-paths.ts for why not /dashboard)
  // before any admin page/layout renders (including RSC fetches on client
  // navigation, which skip the layout). This is the pre-filter only -- the
  // secure check is requireAdminPage() (lib/admin-auth.ts) in the admin layout
  // and every admin page. See "Admin route protection" in CLAUDE.md.
  if (user && isAdminPath(pathname)) {
    const isAdmin = await checkIsAdmin(supabase, user.id, roleClaim)
    if (isAdmin === false) {
      const url = request.nextUrl.clone()
      url.pathname = ADMIN_NO_ACCESS_PATH
      url.search = ''
      const redirectResponse = NextResponse.redirect(url)
      // Keep any session cookies getUser() just refreshed.
      supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
      return redirectResponse
    }
  }

  return supabaseResponse
}

/**
 * Role lookup for the proxy's admin pre-filter. Normally free: the custom
 * access token hook (supabase/migrations/20260926000900_add_role_to_access_token.sql)
 * puts user_profiles.role in the verified token as `app_role`, so no DB read.
 * The claim can be up to one access-token lifetime stale (auth.jwt_expiry),
 * which is fine for a pre-filter: requireAdminPage() re-reads user_profiles.
 *
 * Only when the claim is absent -- a token minted before the hook was
 * enabled, until it refreshes -- does this fall back to one indexed
 * primary-key read of user_profiles. Either way it only runs on /admin
 * paths. Sudo doesn't matter here: the sudo cookie only changes the
 * *effective member* identity, while the signed-in user is still the admin.
 *
 * Returns null when the answer is unknown (Supabase slow/erroring) so the
 * caller lets the request through to the secure requireAdminPage() check,
 * mirroring how a getUser() timeout above doesn't force a /login redirect.
 */
async function checkIsAdmin(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  roleClaim: string | null | undefined
): Promise<boolean | null> {
  if (roleClaim !== undefined) return roleClaim === 'admin'
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase.from('user_profiles').select('role').eq('id', userId).maybeSingle()
      ),
      AUTH_CHECK_TIMEOUT_MS
    )
    if (error) return null
    return (data as { role?: string } | null)?.role === 'admin'
  } catch {
    return null
  }
}
