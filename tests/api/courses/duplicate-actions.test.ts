import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * Duplicating a course, against the real database. Who is calling is faked (and the test client bypasses row-level
 * security; the function's own checks and the audit entry are in supabase/tests/database/duplicate_course.test.sql):
 * what is tested here is what the action answers and writes.
 */

const ts = Date.now()
const PREFIX = `test-duplicate-${ts}`

const auth = vi.hoisted(() => ({ admin: true, client: null as unknown }))
vi.mock('@/lib/admin-auth', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return {
    requireAdminAction: async () => (auth.admin ? { ok: true, user: { id: 'user-admin', email: 'admin@example.test' }, supabase: auth.client ?? getTestSupabaseAdminClient() } : { ok: false, error: 'Not authorized' }),
  }
})
vi.mock('@/lib/analytics/server', () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))

import { duplicateCourse } from '@/app/(admin)/admin/courses/duplicate-actions'

describe('duplicateCourse', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    const course = async (slug: string, source: string, key?: string) => (await supabase.from('courses').insert({ slug: `${PREFIX}-${slug}`, title: slug, source, source_key: key ?? null }).select('id').single()).data!.id
    ids.kajabi = await course('kajabi', 'kajabi', `${PREFIX}-k`)
    ids.deep = await course('deep', 'kajabi', `${PREFIX}-deep`)
    ids.module = (await supabase.from('course_modules').insert({ course_id: ids.kajabi, title: 'M', position: 1, publishing_option: 'published', state: 'open', source: 'kajabi', source_key: `${PREFIX}-m` }).select('id').single()).data!.id
    await supabase.from('course_lessons').insert({ course_id: ids.kajabi, module_id: ids.module, title: 'L', position: 1, publishing_option: 'published', state: 'open', source: 'kajabi', source_key: `${PREFIX}-l` })
    const d1 = (await supabase.from('course_modules').insert({ course_id: ids.deep, title: 'D1', position: 1, publishing_option: 'published', state: 'open', source: 'kajabi', source_key: `${PREFIX}-d1` }).select('id').single()).data!.id
    const d2 = (await supabase.from('course_modules').insert({ course_id: ids.deep, parent_id: d1, title: 'D2', position: 1, publishing_option: 'published', state: 'open', source: 'kajabi', source_key: `${PREFIX}-d2` }).select('id').single()).data!.id
    await supabase.from('course_modules').insert({ course_id: ids.deep, parent_id: d2, title: 'D3', position: 1, publishing_option: 'published', state: 'open', source: 'kajabi', source_key: `${PREFIX}-d3` })
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
    expect(await duplicateCourse('nope')).toEqual({ error: 'Course not found.' })
    expect(await duplicateCourse('crs_AAAAAAAAAAA1')).toEqual({ error: 'Course not found.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses a course whose modules nest deeper than the editor does', async () => {
    expect(await duplicateCourse(ids.deep)).toEqual({ error: expect.stringMatching(/nested deeper than the editor handles/) })
    expect((await supabase.from('courses').select('id').like('slug', `${PREFIX}-deep-copy%`)).data).toEqual([])
  })

  it('says so when the database refuses for a reason it cannot name, and when it says permission is denied', async () => {
    auth.client = { rpc: async () => ({ data: null, error: { message: 'connection lost', code: '08006' } }) }
    expect(await duplicateCourse(ids.kajabi)).toEqual({ error: "Couldn't copy the course." })
    auth.client = { rpc: async () => ({ data: null, error: { message: 'permission denied', code: '42501' } }) }
    expect(await duplicateCourse(ids.kajabi)).toEqual({ error: "You can't copy this course." })
    auth.client = { rpc: async () => ({ data: null, error: { message: 'not_editable' } }) }
    expect(await duplicateCourse(ids.kajabi)).toEqual({ error: "You can't copy this course." })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('does nothing for someone who is not an admin', async () => {
    auth.admin = false
    expect(await duplicateCourse(ids.kajabi)).toEqual({ error: 'Not authorized' })
    expect((await supabase.from('courses').select('id').like('slug', `${PREFIX}-kajabi-copy%`)).data).toEqual([])
  })

  it('makes a draft course the Hub owns, answers with its id, and refreshes the course list', async () => {
    const result = await duplicateCourse(ids.kajabi)
    expect(result.id).toMatch(/^crs_/)
    expect(result.error).toBeUndefined()
    expect((await supabase.from('courses').select('source, source_key, is_draft, slug').eq('id', result.id!).single()).data).toEqual({ source: 'hub', source_key: null, is_draft: true, slug: `${PREFIX}-kajabi-copy` })
    expect((await supabase.from('course_lessons').select('title, source, publishing_option').eq('course_id', result.id!)).data).toEqual([{ title: 'L', source: 'hub', publishing_option: 'draft' }])
    expect(revalidatePath).toHaveBeenCalledWith('/admin/courses')
    // The original is as it was.
    expect((await supabase.from('courses').select('source, source_key').eq('id', ids.kajabi).single()).data).toEqual({ source: 'kajabi', source_key: `${PREFIX}-k` })
  })
})
