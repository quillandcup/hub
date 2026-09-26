'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { signSudoCookie } from '@/lib/sudo'
import { sudoExitPath, sudoLandingPath } from '@/lib/sudo-redirect'

async function requireAdmin() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') throw new Error('Not authorized')

  return { user, supabase }
}

/**
 * Start browsing as a member.
 *
 * @param landingUrl Page to land on once sudo is active — typically the page
 *   the admin is currently on (so they see that same page as the member), or a
 *   feedback item's page_url. Absolute URLs and relative paths are both
 *   accepted; only the path+search+hash is kept. Admin-only pages (and
 *   anything missing/invalid) fall back to the dashboard.
 */
export async function startSudo(memberId: string, landingUrl?: string) {
  const { user, supabase } = await requireAdmin()

  const { data: member } = await supabase
    .from('members')
    .select('id')
    .eq('id', memberId)
    .single()

  if (!member) throw new Error('Member not found')

  const headersList = await headers()
  // The page sudo was started from, so exiting returns there. The Referer is
  // an absolute URL; keep only its same-origin path.
  const returnTo = sudoExitPath(headersList.get('referer'))

  const cookieStore = await cookies()
  const isProduction = process.env.NODE_ENV === 'production'
  const cookieOpts = { httpOnly: true, secure: isProduction, sameSite: 'strict' as const, path: '/' }

  cookieStore.set('sudo_as', signSudoCookie(user.id, memberId), cookieOpts)
  cookieStore.set('sudo_return_to', returnTo, cookieOpts)

  redirect(sudoLandingPath(landingUrl))
}

export async function exitSudo() {
  const cookieStore = await cookies()
  const returnTo = sudoExitPath(cookieStore.get('sudo_return_to')?.value)

  cookieStore.delete('sudo_as')
  cookieStore.delete('sudo_return_to')

  redirect(returnTo)
}
