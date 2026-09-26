import { describe, it, expect } from 'vitest'
import { toSafeRelativePath, sudoLandingPath, sudoExitPath } from '@/lib/sudo-redirect'

describe('toSafeRelativePath', () => {
  it('keeps same-origin relative paths with search and hash', () => {
    expect(toSafeRelativePath('/calendar')).toBe('/calendar')
    expect(toSafeRelativePath('/projects/123?tab=books#top')).toBe('/projects/123?tab=books#top')
  })

  it('reduces absolute URLs to their path, discarding the host', () => {
    expect(toSafeRelativePath('https://hub.example.com/streaks?x=1')).toBe('/streaks?x=1')
    expect(toSafeRelativePath('https://evil.com/dashboard')).toBe('/dashboard')
  })

  it('rejects protocol-relative and backslash open-redirect forms', () => {
    expect(toSafeRelativePath('//evil.com')).toBeNull()
    expect(toSafeRelativePath('//evil.com/dashboard')).toBeNull()
    expect(toSafeRelativePath('/\\evil.com')).toBeNull()
    expect(toSafeRelativePath('https://hub.example.com//evil.com')).toBeNull()
  })

  it('rejects non-http schemes and non-path relative strings', () => {
    expect(toSafeRelativePath('javascript:alert(1)')).toBeNull()
    expect(toSafeRelativePath('data:text/html,hi')).toBeNull()
    expect(toSafeRelativePath('dashboard')).toBeNull()
    expect(toSafeRelativePath('?x=1')).toBeNull()
  })

  it('rejects empty input', () => {
    expect(toSafeRelativePath(undefined)).toBeNull()
    expect(toSafeRelativePath(null)).toBeNull()
    expect(toSafeRelativePath('')).toBeNull()
  })
})

describe('sudoLandingPath', () => {
  it('stays on the current member page', () => {
    expect(sudoLandingPath('/calendar?view=week')).toBe('/calendar?view=week')
    expect(sudoLandingPath('/members/abc')).toBe('/members/abc')
  })

  it('falls back to the dashboard for admin-only pages', () => {
    expect(sudoLandingPath('/admin')).toBe('/dashboard')
    expect(sudoLandingPath('/admin/members/abc?tab=x')).toBe('/dashboard')
    expect(sudoLandingPath('https://hub.example.com/admin/feedback')).toBe('/dashboard')
  })

  it('does not treat paths that merely start with "admin" as admin pages', () => {
    expect(sudoLandingPath('/administrivia')).toBe('/administrivia')
  })

  it('falls back to the dashboard for missing or unsafe targets', () => {
    expect(sudoLandingPath(undefined)).toBe('/dashboard')
    expect(sudoLandingPath('//evil.com')).toBe('/dashboard')
    expect(sudoLandingPath('javascript:alert(1)')).toBe('/dashboard')
  })
})

describe('sudoExitPath', () => {
  it('returns to the page sudo was started from, including admin pages', () => {
    expect(sudoExitPath('/admin/members/abc')).toBe('/admin/members/abc')
    expect(sudoExitPath('https://hub.example.com/calendar?view=week')).toBe('/calendar?view=week')
  })

  it('falls back to /admin for missing or unsafe targets', () => {
    expect(sudoExitPath(undefined)).toBe('/admin')
    expect(sudoExitPath('//evil.com')).toBe('/admin')
  })
})
