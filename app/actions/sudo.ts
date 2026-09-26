'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireAdminAction } from '@/lib/admin-auth'
import { signSudoCookie } from '@/lib/sudo'
import { sudoExitPath, sudoLandingPath } from '@/lib/sudo-redirect'

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
  // Throws (as before) rather than returning { error }: callers treat a failed start as an exception.
  const auth = await requireAdminAction()
  if (!auth.ok) throw new Error(auth.error)
  const { user, supabase } = auth

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
