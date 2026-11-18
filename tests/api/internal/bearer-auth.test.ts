import { describe, it, expect, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { bearerMatches } from '@/lib/webhook-auth'
import { POST as memberReminders } from '@/app/api/internal/member-reminders/route'
import { POST as prickleCheckins } from '@/app/api/internal/prickle-checkins/route'

describe('bearerMatches', () => {
  it('accepts the exact secret', () => {
    expect(bearerMatches('s3cret', 'Bearer s3cret')).toBe(true)
  })

  it.each([
    ['a wrong secret', 'Bearer other'],
    ['a longer secret', 'Bearer s3cret-and-more'],
    ['no scheme', 's3cret'],
    ['a different scheme', 'Basic s3cret'],
    ['an empty header', ''],
    ['no header', null],
  ])('rejects %s', (_label, header) => {
    expect(bearerMatches('s3cret', header)).toBe(false)
  })

  it('never matches while the secret is unset', () => {
    expect(bearerMatches(undefined, 'Bearer ')).toBe(false)
    expect(bearerMatches('', 'Bearer ')).toBe(false)
  })
})

describe('internal routes refuse a bad bearer before doing any work', () => {
  afterEach(() => vi.unstubAllEnvs())

  const call = (post: (r: NextRequest) => Promise<Response>, header?: string) =>
    post(
      new NextRequest('http://localhost:3000/api/internal/x', {
        method: 'POST',
        headers: header ? { authorization: header } : {},
      })
    )

  it.each([
    ['member-reminders', memberReminders],
    ['prickle-checkins', prickleCheckins],
  ])('%s returns 401 for a wrong or missing secret and while unset', async (_name, post) => {
    vi.stubEnv('CRON_INTERNAL_SECRET', 'right-secret')
    expect((await call(post, 'Bearer wrong')).status).toBe(401)
    expect((await call(post)).status).toBe(401)
    vi.stubEnv('CRON_INTERNAL_SECRET', '')
    expect((await call(post, 'Bearer ')).status).toBe(401)
  })
})
