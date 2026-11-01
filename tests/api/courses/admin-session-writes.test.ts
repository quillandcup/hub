import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * Regression: a signed-in admin can READ the course tables but not write them (only the service
 * role can), so the import and processing routes must check the admin and then write with the
 * service role. The other course tests authenticate with the service-role key and would not have
 * caught a route that wrote with the admin's own session.
 *
 * Here the admin check passes but the session's own client refuses every use, standing in for the
 * limited admin session; the service-role client is the real local one.
 */

const ts = Date.now()
const COURSE = `test-asw-${ts}`
const TITLE = `Admin Session ${ts}`
const SLUG = `admin-session-${ts}`

const session = vi.hoisted(() => ({
  limited: new Proxy({}, { get: () => { throw new Error('the route used the admin session client to write') } }),
}))

vi.mock('@/lib/supabase/api-auth', () => ({
  requireAdmin: async () => ({ user: { id: 'admin-user' }, forbidden: false, supabase: session.limited }),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() }
})
vi.mock('@/lib/kajabi/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kajabi/client')>()),
  createKajabiClient: () => ({
    fetchAllCourses: async () => [{ id: COURSE, type: 'courses', attributes: {} }],
    fetchCourse: async () => ({
      data: { id: COURSE, type: 'courses', attributes: { title: TITLE, description: 'd' } },
      included: [{ id: `${COURSE}-l`, type: 'lessons', attributes: { title: 'L', position: 1, publishing_option: 'published' }, relationships: {} }],
    }),
  }),
}))

import { POST as importRoute } from '@/app/api/import/kajabi-courses/route'
import { POST as processRoute } from '@/app/api/process/courses/route'
import type { NextRequest } from 'next/server'

const post = (body: unknown) =>
  new Request('http://localhost:3000/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as unknown as NextRequest

describe('Course routes with a signed-in admin session', () => {
  const supabase = getTestSupabaseAdminClient()

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE)
    await supabase.schema('bronze').from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await supabase.schema('bronze').from('kajabi_courses').delete().eq('kajabi_id', COURSE)
  }
  beforeAll(cleanup)
  afterAll(cleanup)

  it('imports course structure through the service role', async () => {
    const response = await importRoute(post({ courseIds: [COURSE] }))
    expect(response.status).toBe(200)
    const { data } = await supabase.schema('bronze').from('kajabi_course_lessons').select('kajabi_id').eq('course_kajabi_id', COURSE)
    expect(data).toHaveLength(1)
  })

  it('processes into Silver through the service role', async () => {
    const response = await processRoute(post({ course: SLUG, publish: true }))
    expect(response.status).toBe(200)
    expect((await supabase.from('courses').select('slug').eq('source_key', COURSE).single()).data?.slug).toBe(SLUG)
  })
})
