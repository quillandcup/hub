import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * The mark-complete action checks for itself (it is a directly callable endpoint): a caller with
 * courses on, access to the lesson's course, an open lesson, and not in sudo. Real database; only
 * the caller (who is signed in) and the Supabase clients (the service role stands in for the
 * member's own session) are faked.
 */

const state = vi.hoisted(() => ({
  failWrites: false,
  caller: null as null | { userId: string; identity: { memberId: string; isSudo: boolean }; scope: { memberId: string; isAdminActing: boolean } },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/courses/caller', () => ({ getCoursesCaller: async () => state.caller }))
vi.mock('@/lib/supabase/server', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  const admin = getTestSupabaseAdminClient()
  // `failWrites` stands in for the member's own session refusing the write.
  return { createClient: async () => (state.failWrites ? { from: () => ({ upsert: async () => ({ error: { message: 'boom' } }) }) } : admin) }
})
vi.mock('@/lib/supabase/service', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() }
})

import { setLessonComplete } from '@/app/(member)/courses/actions'

const ts = Date.now()
const SLUG = `set-complete-${ts}`

describe('setLessonComplete', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}

  const callAs = (who: string, over: { isSudo?: boolean; isAdminActing?: boolean } = {}) => {
    state.caller = {
      userId: 'user',
      identity: { memberId: ids[who], isSudo: over.isSudo ?? false },
      scope: { memberId: ids[who], isAdminActing: over.isAdminActing ?? false },
    }
  }
  const progress = async (who: string, lesson: string) =>
    (await supabase.from('lesson_progress').select('completed_at').eq('member_id', ids[who]).eq('lesson_id', ids[lesson]).maybeSingle()).data

  beforeAll(async () => {
    const now = new Date()
    const { data: members } = await supabase
      .from('members')
      .insert(['current', 'ended', 'none'].map((who) => ({ name: `Set Complete ${who}`, email: `set-complete-${who}-${ts}@example.com`, joined_at: now.toISOString(), status: 'active' })))
      .select('id, email')
    for (const who of ['current', 'ended', 'none']) ids[who] = members!.find((m) => m.email === `set-complete-${who}-${ts}@example.com`)!.id

    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `Set Complete ${ts}`, source_key: SLUG }).select('id').single()
    ids.course = course!.id
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, title: 'open', position: 1, state: 'open', source_key: `${SLUG}-open` },
        { course_id: ids.course, title: 'soon', position: 2, state: 'coming_soon', source_key: `${SLUG}-soon` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[l.title] = l.id
    await supabase.from('course_access').insert([
      { member_id: ids.current, course_id: ids.course, starts_at: new Date(now.getTime() - 86_400_000).toISOString(), ends_at: null, origin: 'purchase' },
      { member_id: ids.ended, course_id: ids.course, starts_at: new Date(now.getTime() - 500 * 86_400_000).toISOString(), ends_at: new Date(now.getTime() - 100 * 86_400_000).toISOString(), origin: 'purchase' },
    ])
  })

  afterAll(async () => {
    await supabase.from('courses').delete().eq('id', ids.course)
    await supabase.from('members').delete().like('email', `set-complete-%-${ts}@example.com`)
  })

  beforeEach(async () => {
    state.caller = null
    state.failWrites = false
    await supabase.from('member_activities').delete().in('member_id', [ids.current, ids.ended, ids.none]).eq('source', 'courses')
  })

  const completedActivities = async (who: string) =>
    (await supabase.from('member_activities').select('title, engagement_value, related_id').eq('member_id', ids[who]).eq('activity_type', 'lesson_completed')).data ?? []

  it('logs completing a lesson in the activity log once, however often it is marked, and not unmarking', async () => {
    callAs('current')
    await setLessonComplete(ids.open, true)
    await setLessonComplete(ids.open, false)
    await setLessonComplete(ids.open, true)
    expect(await completedActivities('current')).toEqual([{ title: 'Completed open', engagement_value: 5, related_id: ids.open }])
  })

  it('logs nothing in sudo or when the lesson is refused', async () => {
    callAs('current', { isSudo: true })
    await setLessonComplete(ids.open, true)
    callAs('none')
    await setLessonComplete(ids.open, true)
    callAs('current')
    await setLessonComplete(ids.soon, true)
    expect(await completedActivities('current')).toEqual([])
    expect(await completedActivities('none')).toEqual([])
  })

  it('marks a lesson complete, and complete again is the same, and un-completes', async () => {
    callAs('current')
    expect(await setLessonComplete(ids.open, true)).toEqual({})
    const first = (await progress('current', 'open'))?.completed_at
    expect(first).toBeTruthy()

    expect(await setLessonComplete(ids.open, true)).toEqual({})
    expect(await progress('current', 'open')).toBeTruthy()

    expect(await setLessonComplete(ids.open, false)).toEqual({})
    expect((await progress('current', 'open'))?.completed_at).toBeNull()
  })

  it('refuses when courses is off or nobody is signed in', async () => {
    expect(await setLessonComplete(ids.open, true)).toEqual({ error: 'Not available' })
  })

  it("is read-only in sudo: an admin previewing as a member never changes that member's progress", async () => {
    callAs('current', { isSudo: true })
    const result = await setLessonComplete(ids.open, true)
    expect(result.error).toMatch(/viewing as a member/)
    expect((await progress('current', 'open'))?.completed_at).toBeNull()
  })

  it('refuses without access, with ended access, and for a lesson coming soon', async () => {
    callAs('none')
    expect((await setLessonComplete(ids.open, true)).error).toMatch(/access/)
    callAs('ended')
    expect((await setLessonComplete(ids.open, true)).error).toMatch(/access/)
    callAs('current')
    expect(await setLessonComplete(ids.soon, true)).toEqual({ error: 'Lesson not found' })
    expect(await progress('none', 'open')).toBeNull()
    expect(await progress('ended', 'open')).toBeNull()
  })

  it("says so, without leaking the error, when the member's own write fails", async () => {
    callAs('current')
    state.failWrites = true
    expect(await setLessonComplete(ids.open, true)).toEqual({ error: "Couldn't save your progress" })
  })

  it('refuses an id that is not a lesson id', async () => {
    callAs('current')
    expect(await setLessonComplete('not-a-uuid', true)).toEqual({ error: 'Lesson not found' })
    expect(await setLessonComplete('00000000-0000-4000-a000-000000000000', true)).toEqual({ error: 'Lesson not found' })
  })
})
