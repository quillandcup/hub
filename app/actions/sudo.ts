'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signSudoCookie } from '@/lib/sudo'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') throw new Error('Not authorized')

  return { user, supabase }
}

// landingUrl is attacker-influenced (e.g. a feedback item's self-reported
// page_url), so only the path+search+hash survives — the scheme/host are
// discarded rather than validated, which rules out an open redirect
// regardless of what host was supplied.
function sanitizeLandingPath(url: string | undefined): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`
  return path.startsWith('/') && !path.startsWith('//') ? path : null
}

export async function startSudo(memberId: string, landingUrl?: string) {
  const { user, supabase } = await requireAdmin()

  const { data: member } = await supabase
    .from('members')
    .select('id')
    .eq('id', memberId)
    .single()

  if (!member) throw new Error('Member not found')

  const headersList = await headers()
  const returnTo = headersList.get('referer') || '/admin'

  const cookieStore = await cookies()
  const isProduction = process.env.NODE_ENV === 'production'
  const cookieOpts = { httpOnly: true, secure: isProduction, sameSite: 'strict' as const, path: '/' }

  cookieStore.set('sudo_as', signSudoCookie(user.id, memberId), cookieOpts)
  cookieStore.set('sudo_return_to', returnTo, cookieOpts)

  redirect(sanitizeLandingPath(landingUrl) ?? '/dashboard')
}

export async function exitSudo() {
  const cookieStore = await cookies()
  const rawReturnTo = cookieStore.get('sudo_return_to')?.value || '/admin'
  const returnTo = rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
    ? rawReturnTo
    : '/admin'

  cookieStore.delete('sudo_as')
  cookieStore.delete('sudo_return_to')

  redirect(returnTo)
}
