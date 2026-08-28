import { createServerClient } from '@supabase/ssr'
import { NextResponse, after, type NextRequest } from 'next/server'
import { withTimeout, AUTH_CHECK_TIMEOUT_MS } from '@/lib/with-timeout'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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
    }
  )

  let user = null
  try {
    const { data } = await withTimeout(supabase.auth.getUser(), AUTH_CHECK_TIMEOUT_MS)
    user = data.user
  } catch {
    // Supabase unreachable or too slow to respond — treat as unauthenticated
    // rather than hang until Vercel's 25s middleware cap kills the request.
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
    after(async () => {
      try {
        await supabase.from('access_events').insert({
          user_id: userId,
          path: pathname,
          is_page: !pathname.startsWith('/api/'),
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

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
