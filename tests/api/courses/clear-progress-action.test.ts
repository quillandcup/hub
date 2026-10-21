import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * clearMyLessonProgress, the staff-only "clear my progress for this lesson": wipes the signed-in
 * staff member's own watch segments and progress row for one lesson, nobody else's. Real database;
 * who is calling is faked.
 */

const ts = Date.now()
const SLUG = `clear-progress-${ts}`
const emailOf = (who: string) => `clear-progress-${who}-${ts}@example.com`

const auth = vi.hoisted(() => ({ admin: true }))
const caller = vi.hoisted(() => ({ current: null as null | { identity: { memberId: string; isSudo: boolean }; scope: { memberId: string; isAdminActing: boolean } } }))
vi.mock('@/lib/admin-auth', () => ({ requireAdminAction: async () => (auth.admin ? { ok: true } : { ok: false, error: 'Not authorized' }) }))
vi.mock('@/lib/courses/caller', () => ({ getCoursesCaller: async () => caller.current }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { clearMyLessonProgress } from '@/app/(member)/courses/actions'

describe('clearMyLessonProgress', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const actAs = (who: string, over: { isSudo?: boolean; isAdminActing?: boolean } = {}) => {
    caller.current = { identity: { memberId: ids[who], isSudo: over.isSudo ?? false }, scope: { memberId: ids[who], isAdminActing: over.isAdminActing ?? true } }
  }
  const segmentCount = async (who: string, video = ids.video) => (await supabase.from('video_watch_segments').select('id').eq('member_id', ids[who]).eq('video_id', video)).data?.length ?? 0
  const progressCount = async (who: string, lesson: string) => (await supabase.from('lesson_progress').select('lesson_id').eq('member_id', ids[who]).eq('lesson_id', lesson)).data?.length ?? 0

  beforeAll(async () => {
    const { data: members } = await supabase
      .from('members')
      .insert(['staff', 'other'].map((who) => ({ name: `Clear Progress ${who}`, email: emailOf(who), joined_at: new Date().toISOString(), status: 'active' })))
      .select('id, email')
    for (const who of ['staff', 'other']) ids[who] = members!.find((m) => m.email === emailOf(who))!.id
    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `Clear Progress ${ts}`, source_key: SLUG }).select('id').single()
    ids.course = course!.id
    const { data: videos } = await supabase
      .from('videos')
      .insert(['a', 'b'].map((k) => ({ source_kind: 'upload', source_key: `${SLUG}-${k}`, status: 'ready', mux_playback_id: `pb-${k}` })))
      .select('id, source_key')
    ids.video = videos!.find((v) => v.source_key === `${SLUG}-a`)!.id
    ids.otherVideo = videos!.find((v) => v.source_key === `${SLUG}-b`)!.id
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, title: 'A', position: 1, state: 'coming_soon', video_id: ids.video, source_key: `${SLUG}-a` },
        { course_id: ids.course, title: 'B', position: 2, state: 'open', video_id: ids.otherVideo, source_key: `${SLUG}-b` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[`lesson${l.title}`] = l.id
  })
  afterAll(async () => {
    await supabase.from('courses').delete().eq('id', ids.course)
    await supabase.from('videos').delete().in('id', [ids.video, ids.otherVideo])
    await supabase.from('members').delete().in('id', [ids.staff, ids.other])
  })
  beforeEach(async () => {
    auth.admin = true
    const row = (who: string, video: string, n: number) => ({ member_id: ids[who], video_id: video, session_id: crypto.randomUUID(), start_seconds: n, end_seconds: n + 5, client_segment_id: crypto.randomUUID() })
    await supabase.from('video_watch_segments').delete().in('member_id', [ids.staff, ids.other])
    await supabase.from('lesson_progress').delete().in('member_id', [ids.staff, ids.other])
    await supabase.from('video_watch_segments').insert([row('staff', ids.video, 0), row('staff', ids.video, 10), row('staff', ids.otherVideo, 0), row('other', ids.video, 0)])
    await supabase.from('lesson_progress').insert([
      { member_id: ids.staff, lesson_id: ids.lessonA, last_position_seconds: 15, completed_at: new Date().toISOString() },
      { member_id: ids.staff, lesson_id: ids.lessonB, last_position_seconds: 9 },
      { member_id: ids.other, lesson_id: ids.lessonA, last_position_seconds: 40 },
    ])
    actAs('staff')
  })

  it("clears the staff member's own segments and progress for that lesson only", async () => {
    expect(await clearMyLessonProgress(ids.lessonA)).toEqual({ segments: 2 })
    expect(await segmentCount('staff')).toBe(0)
    expect(await progressCount('staff', ids.lessonA)).toBe(0)
    // Their other lesson, and another member's rows on the same lesson, are untouched.
    expect(await segmentCount('staff', ids.otherVideo)).toBe(1)
    expect(await progressCount('staff', ids.lessonB)).toBe(1)
    expect(await segmentCount('other')).toBe(1)
    expect(await progressCount('other', ids.lessonA)).toBe(1)
  })

  it('refuses anyone who is not an admin, and an admin in sudo or without the courses feature', async () => {
    auth.admin = false
    expect(await clearMyLessonProgress(ids.lessonA)).toEqual({ error: 'Not authorized' })
    auth.admin = true
    actAs('staff', { isAdminActing: false, isSudo: true })
    expect(await clearMyLessonProgress(ids.lessonA)).toEqual({ error: 'Not available' })
    caller.current = null
    expect(await clearMyLessonProgress(ids.lessonA)).toEqual({ error: 'Not available' })
    expect(await segmentCount('staff')).toBe(2)
    expect(await progressCount('staff', ids.lessonA)).toBe(1)
  })

  it('answers not found for an id that is not a lesson or does not exist', async () => {
    expect(await clearMyLessonProgress('not-a-uuid')).toEqual({ error: 'Lesson not found' })
    expect(await clearMyLessonProgress('00000000-0000-4000-a000-0000000000ff')).toEqual({ error: 'Lesson not found' })
  })
})
