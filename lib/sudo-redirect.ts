/**
 * Redirect-target helpers for starting/exiting sudo (browse-as-member).
 *
 * Every target here is influenced by the client (a path the browser reports,
 * the Referer header, a feedback item's self-reported page_url), so it is
 * reduced to a same-origin path+search+hash: any scheme/host is discarded
 * rather than validated, which rules out an open redirect regardless of what
 * host was supplied.
 */

const PLACEHOLDER_ORIGIN = 'http://sudo.invalid'

export const SUDO_MEMBER_FALLBACK_PATH = '/dashboard'
export const SUDO_EXIT_FALLBACK_PATH = '/admin'

/**
 * Reduce an absolute URL or a relative path to a safe same-origin path
 * (pathname + search + hash). Returns null for anything unusable, including
 * protocol-relative (`//evil.com`) and backslash (`/\evil.com`) forms that
 * browsers would resolve to another host.
 */
export function toSafeRelativePath(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  // Relative inputs must look like an absolute path; "foo" or "?x" would
  // otherwise silently resolve against the placeholder origin.
  const isAbsoluteUrl = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  if (!isAbsoluteUrl && (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\'))) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed, PLACEHOLDER_ORIGIN)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : null
}

function isAdminPath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0]
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

/**
 * Where to send the admin right after sudo starts: the page they were on, so
 * they can see that same page as the member. Admin-only pages have no member
 * view (the admin layout ignores sudo), so those fall back to the dashboard.
 */
export function sudoLandingPath(input: string | null | undefined): string {
  const path = toSafeRelativePath(input)
  if (!path || isAdminPath(path)) return SUDO_MEMBER_FALLBACK_PATH
  return path
}

/**
 * Where to send the admin when they exit sudo: back to the page they started
 * sudo from (stored at start). Falls back to /admin.
 */
export function sudoExitPath(input: string | null | undefined): string {
  return toSafeRelativePath(input) ?? SUDO_EXIT_FALLBACK_PATH
}
