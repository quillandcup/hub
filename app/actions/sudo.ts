'use server'

import { createRepos } from "@/lib/data/repos";
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireAdminAction } from '@/lib/admin-auth'
import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { signSudoCookie } from '@/lib/sudo'
import { SUDO_COOKIE_NAME, SUDO_RETURN_COOKIE_NAME, parseSudoCookie } from '@/lib/sudo-cookie'
import { sudoExitPath, sudoLandingPath } from '@/lib/sudo-redirect'

type SudoEvent = 'sudo_started' | 'sudo_ended'

/**
 * Best-effort record of a sudo session's boundaries in the activity log (a staff
 * action about the member, so the Audit view shows it), log-and-continue on failure
 * like the other append-only mirrors. The page visits in between come from access_events.
 */
async function logSudoEvent(supabase: Awaited<ReturnType<typeof createClient>>, adminId: string, memberId: string, type: SudoEvent) {
  await createRepos(supabase)
    .activities.record({
      memberId,
      type,
      category: 'admin',
      title: type === 'sudo_started' ? 'Started viewing as this member' : 'Stopped viewing as this member',
      actorKind: 'staff',
      actorUserId: adminId,
      engagementValue: 0, // staff action, not the member's engagement
      occurredAt: new Date().toISOString(),
      source: 'sudo',
    })
    .catch((error) => console.error(`Error logging ${type} to member_activities:`, error))
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
  // Throws (as before) rather than returning { error }: callers treat a failed start as an exception.
  const auth = await requireAdminAction()
  if (!auth.ok) throw new Error(auth.error)
  const { user, supabase } = auth

  const member = await createRepos(supabase).members.byId(memberId)

  if (!member) throw new Error('Member not found')

  await logSudoEvent(supabase, user.id, memberId, 'sudo_started')

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

  // Only a valid cookie held by the signed-in admin counts as a session ending.
  const sudo = parseSudoCookie(cookieStore.get(SUDO_COOKIE_NAME)?.value ?? '')
  const user = sudo ? await getCurrentUser() : null
  if (sudo && user && sudo.adminId === user.id) {
    await logSudoEvent(await createClient(), user.id, sudo.memberId, 'sudo_ended')
  }

  cookieStore.delete('sudo_as')
  cookieStore.delete('sudo_return_to')

  redirect(returnTo)
}
