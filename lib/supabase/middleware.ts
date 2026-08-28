import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
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
