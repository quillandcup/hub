import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * Deleting a course, against the real database. Who is calling is faked (and the test client bypasses row-level
 * security; the function's own checks and the audit entry are in supabase/tests/database/delete_course.test.sql):
 * what is tested here is what the action answers and writes.
 */

const ts = Date.now()
const PREFIX = `test-delete-${ts}`

const auth = vi.hoisted(() => ({ admin: true, client: null as unknown }))
vi.mock('@/lib/admin-auth', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return {
    requireActionPermission: async () => (auth.admin ? { ok: true, user: { id: 'user-admin', email: 'admin@example.test' }, supabase: auth.client ?? getTestSupabaseAdminClient() } : { ok: false, error: 'Not authorized' }),
  }
})
vi.mock('@/lib/analytics/server', () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))

import { deleteCourse } from '@/app/(admin)/admin/courses/delete-actions'

describe('deleteCourse', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}

  const course = async (slug: string, over: Record<string, unknown> = {}) =>
    (await supabase.from('courses').insert({ slug: `${PREFIX}-${slug}`, title: slug, source: 'hub', source_key: null, is_draft: true, ...over }).select('id').single()).data!.id as string
  const exists = async (id: string) => ((await supabase.from('courses').select('id').eq('id', id)).data ?? []).length === 1

  beforeAll(async () => {
    ids.draft = await course('draft')
    ids.other = await course('other')
    ids.kajabi = await course('kajabi', { source: 'kajabi', source_key: `${PREFIX}-k` })
    ids.published = await course('published', { is_draft: false })
    ids.used = await course('used')
    const moduleId = (await supabase.from('course_modules').insert({ course_id: ids.draft, title: 'M', position: 1, publishing_option: 'draft', state: 'hidden', source: 'hub' }).select('id').single()).data!.id
    await supabase.from('course_lessons').insert([
      { course_id: ids.draft, module_id: moduleId, title: 'L', position: 1, publishing_option: 'draft', state: 'hidden', source: 'hub' },
      { course_id: ids.other, title: 'Other lesson', position: 1, publishing_option: 'draft', state: 'hidden', source: 'hub' },
    ])
    const member = (await supabase.from('members').select('id').limit(1).single()).data!.id
    await supabase.from('course_access_grants').insert({ member_id: member, course_id: ids.used })
  })
  beforeEach(() => {
    auth.admin = true
    auth.client = null
    vi.clearAllMocks()
  })
  afterAll(async () => {
    await supabase.from('courses').delete().like('slug', `${PREFIX}%`)
  })

  it('refuses a course id that is not one and one that is not there, writing nothing', async () => {
    expect(await deleteCourse('nope')).toEqual({ error: 'Course not found.' })
    expect(await deleteCourse('crs_AAAAAAAAAAA1')).toEqual({ error: 'Course not found.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses a course imported from Kajabi, a published one, and one members have access to, and keeps them', async () => {
    expect(await deleteCourse(ids.kajabi)).toEqual({ error: expect.stringMatching(/comes from Kajabi/) })
    expect(await deleteCourse(ids.published)).toEqual({ error: expect.stringMatching(/Unpublish it first/) })
    expect(await deleteCourse(ids.used)).toEqual({ error: expect.stringMatching(/have access to this course/) })
    for (const id of [ids.kajabi, ids.published, ids.used]) expect(await exists(id)).toBe(true)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('says so when the database refuses for a reason it cannot name, and when it says permission is denied', async () => {
    auth.client = { rpc: async () => ({ data: null, error: { message: 'connection lost', code: '08006' } }) }
    expect(await deleteCourse(ids.draft)).toEqual({ error: "Couldn't delete the course." })
    auth.client = { rpc: async () => ({ data: null, error: { message: 'permission denied', code: '42501' } }) }
    expect(await deleteCourse(ids.draft)).toEqual({ error: "You can't delete this course." })
    auth.client = { rpc: async () => ({ data: null, error: { message: 'not_editable' } }) }
    expect(await deleteCourse(ids.draft)).toEqual({ error: "You can't delete this course." })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('does nothing for someone who is not an admin', async () => {
    auth.admin = false
    expect(await deleteCourse(ids.draft)).toEqual({ error: 'Not authorized' })
    expect(await exists(ids.draft)).toBe(true)
  })

  it('deletes an unused draft course with its modules and lessons, refreshes the course list, and leaves other courses alone', async () => {
    expect(await deleteCourse(ids.draft)).toEqual({ ok: true })
    expect(await exists(ids.draft)).toBe(false)
    expect((await supabase.from('course_modules').select('id').eq('course_id', ids.draft)).data).toEqual([])
    expect((await supabase.from('course_lessons').select('id').eq('course_id', ids.draft)).data).toEqual([])
    expect((await supabase.from('course_lessons').select('title').eq('course_id', ids.other)).data).toEqual([{ title: 'Other lesson' }])
    expect(revalidatePath).toHaveBeenCalledWith('/admin/courses')
    // Gone for good: a second try says so.
    expect(await deleteCourse(ids.draft)).toEqual({ error: 'Course not found.' })
  })
})
