import { createHmac, timingSafeEqual } from 'crypto'

// Pure cookie signing/verification, split out of lib/sudo.ts so the Supabase
// clients (lib/supabase/server.ts, the proxy) can read the sudo state without
// importing lib/sudo.ts, which itself imports the server client.

export const SUDO_COOKIE_NAME = 'sudo_as'

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

/**
 * The `X-Acting-As` header value the audit/activity triggers read as
 * `<admin user id>:<member id>` (see current_acting_as_member_id() in the
 * audit_log migration), or null when sudo isn't active for this user. The
 * cookie's HMAC is verified here; the database re-checks the caller is that
 * admin. Pass `userId` when known to also require the cookie belongs to them.
 */
export function actingAsHeaderValue(cookieValue: string | undefined, userId?: string): string | null {
  if (!cookieValue) return null
  const parsed = parseSudoCookie(cookieValue)
  if (!parsed || (userId !== undefined && parsed.adminId !== userId)) return null
  return `${parsed.adminId}:${parsed.memberId}`
}
