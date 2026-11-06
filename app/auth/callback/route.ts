import { createClient } from '@/lib/supabase/server'
import { NextResponse, after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { applyConfirmedEmailChange } from '@/lib/member-email'
import { triggerReprocessing } from '@/lib/processing/trigger'
import { safeNextPath } from '@/lib/safe-next'
import { takeNextPath } from '@/lib/next-path-cookie'
import { callbackOutcome, logSignIn } from '@/lib/signin-log'
import { rememberSignInFailure, rememberSignInMethod } from '@/lib/signin-method'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Only ever a same-origin path: `${origin}${next}` with an unchecked `next` like
      // "@evil.com" would have been an open redirect.
      const next = safeNextPath(searchParams.get('next')) ?? (await takeNextPath())
      await rememberSignInMethod('email_link')
      // The link may be a new-email confirmation; finish what the member asked for. Never blocks sign-in.
      if (data.user) {
        try {
          if (await applyConfirmedEmailChange(createServiceRoleClient(), data.user.id)) {
            after(() => triggerReprocessing('member_email_aliases', 'local'))
          }
        } catch (err) {
          console.error('[auth] Applying a confirmed email change failed:', err)
        }
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
    const outcome = callbackOutcome(error)
    logSignIn(outcome, error)
    await rememberSignInFailure(outcome === 'callback_other_browser' ? 'link_other_browser' : 'link_refused')
  } else {
    logSignIn('callback_no_code')
    await rememberSignInFailure('link_no_code')
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
