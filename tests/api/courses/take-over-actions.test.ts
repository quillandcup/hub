import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * Taking a course over from Kajabi, against the real database. Who is calling is faked (and the test client bypasses
 * row-level security; the function's own checks and the audit entry are in
 * supabase/tests/database/take_over_kajabi_course.test.sql): what is tested here is what the action answers and writes.
 */

const ts = Date.now()
const PREFIX = `test-takeover-${ts}`

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

import { takeOverCourse } from '@/app/(admin)/admin/courses/take-over-actions'

describe('takeOverCourse', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const source = async (table: 'courses' | 'course_modules' | 'course_lessons', id: string) => (await supabase.from(table).select('source').eq('id', id).single()).data!.source

  beforeAll(async () => {
    const course = async (slug: string, source: string, key?: string) => (await supabase.from('courses').insert({ slug: `${PREFIX}-${slug}`, title: slug, source, source_key: key ?? null }).select('id').single()).data!.id
    ids.kajabi = await course('kajabi', 'kajabi', `${PREFIX}-k`)
    ids.hub = await course('hub', 'hub')
    ids.deep = await course('deep', 'kajabi', `${PREFIX}-deep`)
    ids.module = (await supabase.from('course_modules').insert({ course_id: ids.kajabi, title: 'M', position: 1, publishing_option: 'published', state: 'open', source: 'kajabi', source_key: `${PREFIX}-m` }).select('id').single()).data!.id
    ids.lesson = (await supabase.from('course_lessons').insert({ course_id: ids.kajabi, module_id: ids.module, title: 'L', position: 1, publishing_option: null, state: 'hidden', source: 'kajabi', source_key: `${PREFIX}-l` }).select('id').single()).data!.id
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

  it('refuses a course id that is not one, one that is not there, and one the Hub already owns, writing nothing', async () => {
    expect(await takeOverCourse('nope')).toEqual({ error: 'Course not found.' })
    expect(await takeOverCourse('crs_AAAAAAAAAAA1')).toEqual({ error: 'Course not found.' })
    expect(await takeOverCourse(ids.hub)).toEqual({ error: "That course isn't one imported from Kajabi, so there is nothing to take over." })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses a course whose modules nest deeper than the editor does, and leaves it as it was', async () => {
    expect(await takeOverCourse(ids.deep)).toEqual({ error: expect.stringMatching(/nested deeper than the editor handles/) })
    expect(await source('courses', ids.deep)).toBe('kajabi')
  })

  it('says so when the database refuses for a reason it cannot name, and when it says permission is denied', async () => {
    auth.client = { rpc: async () => ({ error: { message: 'connection lost', code: '08006' } }) }
    expect(await takeOverCourse(ids.kajabi)).toEqual({ error: "Couldn't take the course over." })
    auth.client = { rpc: async () => ({ error: { message: 'permission denied', code: '42501' } }) }
    expect(await takeOverCourse(ids.kajabi)).toEqual({ error: "That course isn't one imported from Kajabi, so there is nothing to take over." })
    expect(await source('courses', ids.kajabi)).toBe('kajabi')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('does nothing for someone who is not an admin', async () => {
    auth.admin = false
    expect(await takeOverCourse(ids.kajabi)).toEqual({ error: 'Not authorized' })
    expect(await source('courses', ids.kajabi)).toBe('kajabi')
  })

  it('makes the course, its modules and its lessons the Hub\'s, and refreshes the pages that show them', async () => {
    expect(await takeOverCourse(ids.kajabi)).toEqual({ id: ids.kajabi })

    expect(await source('courses', ids.kajabi)).toBe('hub')
    expect(await source('course_modules', ids.module)).toBe('hub')
    expect(await source('course_lessons', ids.lesson)).toBe('hub')
    // A lesson with no setting in Kajabi is a draft now, as hidden as it was.
    expect((await supabase.from('course_lessons').select('publishing_option, state').eq('id', ids.lesson).single()).data).toEqual({ publishing_option: 'draft', state: 'hidden' })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/courses')
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.kajabi}`)
    expect(revalidatePath).toHaveBeenCalledWith('/courses', 'layout')
  })

  it('says it is not one imported from Kajabi when asked again', async () => {
    expect(await takeOverCourse(ids.kajabi)).toEqual({ error: "That course isn't one imported from Kajabi, so there is nothing to take over." })
  })
})
