import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'

export interface EffectiveIdentity {
  memberId: string
  memberName: string
  memberEmail: string
  isSudo: boolean
}

export function signSudoCookie(adminId: string, memberId: string): string {
  const secret = process.env.SUDO_SECRET
  if (!secret) throw new Error('SUDO_SECRET environment variable is not set')
  const payload = `${adminId}:${memberId}`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}:${sig}`
}

// Cookie format: "${adminId}:${memberId}:${hmacHex}"
// UUIDs contain hyphens but not colons, so split(':') gives exactly 3 parts.
export function parseSudoCookie(value: string): { adminId: string; memberId: string } | null {
  const secret = process.env.SUDO_SECRET
  if (!secret) return null
  const parts = value.split(':')
  if (parts.length !== 3) return null
  const [adminId, memberId, sig] = parts
  const payload = `${adminId}:${memberId}`
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  try {
    const sigBuf = Buffer.from(sig, 'hex')
    const expBuf = Buffer.from(expected, 'hex')
    if (sigBuf.length !== expBuf.length) return null
    if (!timingSafeEqual(sigBuf, expBuf)) return null
  } catch {
    return null
  }
  return { adminId, memberId }
}

export async function getEffectiveIdentity(realUser: User): Promise<EffectiveIdentity | null> {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const sudoCookieValue = cookieStore.get('sudo_as')?.value

  if (sudoCookieValue) {
    const parsed = parseSudoCookie(sudoCookieValue)
    if (parsed && parsed.adminId === realUser.id) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', realUser.id)
        .single()

      if (profile?.role === 'admin') {
        const { data: member } = await supabase
          .from('members')
          .select('id, name, email')
          .eq('id', parsed.memberId)
          .single()

        if (member) {
          return {
            memberId: member.id,
            memberName: member.name,
            memberEmail: member.email,
            isSudo: true,
          }
        }
      }
    }
    // Cookie present but invalid — fall through to real user
  }

  const { data: member } = await supabase
    .from('members')
    .select('id, name, email')
    .eq('email', realUser.email!)
    .single()

  if (!member) return null

  return {
    memberId: member.id,
    memberName: member.name,
    memberEmail: member.email,
    isSudo: false,
  }
}
