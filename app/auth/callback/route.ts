import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { safeNextPath } from '@/lib/safe-next'
import { takeNextPath } from '@/lib/next-path-cookie'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Only ever a same-origin path: `${origin}${next}` with an unchecked `next` like
      // "@evil.com" would have been an open redirect.
      const next = safeNextPath(searchParams.get('next')) ?? (await takeNextPath())
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
