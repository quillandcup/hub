import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { SUDO_COOKIE_NAME, actingAsHeaderValue } from '@/lib/sudo-cookie'

export async function createClient() {
  const cookieStore = await cookies()

  // GoTrue records auth.sessions.user_agent/ip from whatever hit its own
  // endpoint — which, in this SSR architecture, is always this Next.js
  // server, not the visitor's browser. Forward the original request's
  // headers so Active Sessions (app/(member)/settings) shows the member's
  // real device/location instead of Vercel's own runtime identity.
  const headerStore = await headers()
  const userAgent = headerStore.get('user-agent')
  const clientIp = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim()

  // Sudo: tell the database which member the signed-in admin is viewing as, so
  // the audit/activity triggers record both (see current_acting_as_member_id()).
  // PostgREST exposes request headers to triggers as request.headers. The
  // cookie is HMAC-verified here; the database also requires the header to
  // name the caller and the caller to be an admin.
  const actingAs = actingAsHeaderValue(cookieStore.get(SUDO_COOKIE_NAME)?.value)

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
      global: {
        headers: {
          ...(userAgent ? { 'User-Agent': userAgent } : {}),
          ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
          ...(actingAs ? { 'X-Acting-As': actingAs } : {}),
        },
      },
    }
  )
}
