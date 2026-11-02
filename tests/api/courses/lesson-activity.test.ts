import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import {
  recordLessonCompleted,
  recordLessonWatched,
  watchedEnough,
  LESSON_COMPLETED_POINTS_UNKNOWN,
  LESSON_WATCHED_POINTS_UNKNOWN,
  lessonCompletedPoints,
  lessonWatchedPoints,
  WATCHED_SECONDS_THRESHOLD,
} from '@/lib/courses/activity'
import { createRepos } from "@/lib/data/repos";

/**
 * Lesson viewing in the activity log (member_activities, source 'courses'): a watch counts once a day
 * has covered enough of the lesson, one row per member, lesson and day; completing counts once per
 * lesson. Real local database; the service role stands in for the member's own client.
 */

describe('points by lesson length', () => {
  it('grow with the lesson: a 5-minute video is worth less than an hour-long webinar', () => {
    expect(lessonWatchedPoints(5 * 60)).toBe(1)
    expect(lessonWatchedPoints(30 * 60)).toBe(6)
    expect(lessonWatchedPoints(60 * 60)).toBe(10)
    expect(lessonCompletedPoints(5 * 60)).toBe(1)
    expect(lessonCompletedPoints(30 * 60)).toBe(3)
    expect(lessonCompletedPoints(60 * 60)).toBe(5)
  })

  it('has a floor of 1 and tops out at a prickle for watching and 5 for completing', () => {
    expect(lessonWatchedPoints(30)).toBe(1)
    expect(lessonCompletedPoints(30)).toBe(1)
    expect(lessonWatchedPoints(10 * 3600)).toBe(10)
    expect(lessonCompletedPoints(10 * 3600)).toBe(5)
  })

  it('uses the middle of each range when the length is unknown', () => {
    expect(lessonWatchedPoints(null)).toBe(LESSON_WATCHED_POINTS_UNKNOWN)
    expect(lessonWatchedPoints(0)).toBe(LESSON_WATCHED_POINTS_UNKNOWN)
    expect(lessonCompletedPoints(null)).toBe(LESSON_COMPLETED_POINTS_UNKNOWN)
  })
})

describe('watchedEnough', () => {
  it('counts a day of watching by share of the lesson or by minutes', () => {
    expect(watchedEnough(100, 300)).toBe(false)
    expect(watchedEnough(150, 300)).toBe(true)
    expect(watchedEnough(WATCHED_SECONDS_THRESHOLD, 7200)).toBe(true)
    expect(watchedEnough(WATCHED_SECONDS_THRESHOLD - 1, 7200)).toBe(false)
  })

  it('has only the minutes rule when the lesson length is unknown or zero', () => {
    expect(watchedEnough(299, null)).toBe(false)
    expect(watchedEnough(0, 0)).toBe(false)
    expect(watchedEnough(WATCHED_SECONDS_THRESHOLD, null)).toBe(true)
  })
})

const ts = Date.now()
const SLUG = `lesson-activity-${ts}`

describe('lesson activity rows', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const NOW = new Date()
  const activities = async (type?: string) => {
    let q = supabase.from('member_activities').select('*').eq('member_id', ids.member).eq('source', 'courses')
    if (type) q = q.eq('activity_type', type)
    return (await q).data ?? []
  }
  const watch = (over: Partial<Parameters<typeof recordLessonWatched>[1]> = {}, now = NOW) =>
    recordLessonWatched(createRepos(supabase), { memberId: ids.member, lessonId: ids.lesson, courseId: ids.course, lessonTitle: 'Plot Basics', videoId: ids.video, lessonSeconds: 600, ...over }, now)
  const addSegment = (start: number, end: number, startedAt = NOW) =>
    supabase.from('video_watch_segments').insert({
      client_segment_id: crypto.randomUUID(),
      member_id: ids.member,
      video_id: ids.video,
      session_id: crypto.randomUUID(),
      start_seconds: start,
      end_seconds: end,
      started_at: startedAt.toISOString(),
    })

  beforeAll(async () => {
    const { data: member } = await supabase
      .from('members')
      .insert({ name: 'Lesson Activity', email: `lesson-activity-${ts}@example.com`, joined_at: NOW.toISOString(), status: 'active' })
      .select('id')
      .single()
    ids.member = member!.id
    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `Lesson Activity ${ts}`, source_key: SLUG }).select('id').single()
    ids.course = course!.id
    const { data: video } = await supabase.from('videos').insert({ source_kind: 'upload', source_key: SLUG, status: 'ready', mux_playback_id: 'pb-act' }).select('id').single()
    ids.video = video!.id
    const { data: lesson } = await supabase
      .from('course_lessons')
      .insert({ course_id: ids.course, title: 'Plot Basics', position: 1, state: 'open', video_id: ids.video, source_key: `${SLUG}-a` })
      .select('id')
      .single()
    ids.lesson = lesson!.id
  })
  afterAll(async () => {
    await supabase.from('member_activities').delete().eq('member_id', ids.member)
    await supabase.from('courses').delete().eq('id', ids.course)
    await supabase.from('videos').delete().eq('id', ids.video)
    await supabase.from('members').delete().eq('id', ids.member)
  })
  beforeEach(async () => {
    await supabase.from('member_activities').delete().eq('member_id', ids.member)
    await supabase.from('video_watch_segments').delete().eq('member_id', ids.member)
  })

  it('logs nothing until the day has covered enough of the lesson', async () => {
    await addSegment(0, 100)
    await watch()
    expect(await activities()).toEqual([])
  })

  it('logs one "watched" row once enough is covered, adding up the day\'s stretches', async () => {
    await addSegment(0, 100)
    await addSegment(100, 320)
    await watch()
    const rows = await activities('lesson_watched')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      title: 'Watched Plot Basics',
      activity_category: 'learning',
      actor_kind: 'member',
      engagement_value: lessonWatchedPoints(600),
      duration_minutes: 5,
      data: { lesson_id: ids.lesson, course_id: ids.course, watched_seconds: 320 },
    })
  })

  it('is one row per lesson and day however many saves cross the line', async () => {
    await addSegment(0, 400)
    await watch()
    await addSegment(400, 500)
    await watch()
    expect(await activities('lesson_watched')).toHaveLength(1)
  })

  it('logs again on another day, and does not count yesterday\'s stretches toward today', async () => {
    // Another day, not "exactly 24 hours ago": on the day the clocks go back (25 hours long) that is still today, late in the evening.
    const yesterday = new Date(NOW.getTime() - 26 * 60 * 60 * 1000)
    await addSegment(0, 400, yesterday)
    await watch({}, yesterday)
    expect(await activities('lesson_watched')).toHaveLength(1)

    await addSegment(0, 100)
    await watch()
    expect(await activities('lesson_watched')).toHaveLength(1)

    await addSegment(100, 400)
    await watch()
    expect(await activities('lesson_watched')).toHaveLength(2)
  })

  it('ignores "viewed" markers', async () => {
    await supabase.from('video_watch_segments').insert({
      client_segment_id: crypto.randomUUID(), member_id: ids.member, video_id: ids.video, session_id: crypto.randomUUID(), kind: 'viewed', start_seconds: 0, end_seconds: 0,
    })
    await watch({ lessonSeconds: null })
    expect(await activities()).toEqual([])
  })

  it('logs "completed" once per lesson, even after unmarking and marking again', async () => {
    const lesson = { memberId: ids.member, lessonId: ids.lesson, courseId: ids.course, lessonTitle: 'Plot Basics', lessonSeconds: 1800 }
    await recordLessonCompleted(createRepos(supabase), lesson)
    await recordLessonCompleted(createRepos(supabase), lesson)
    const rows = await activities('lesson_completed')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Completed Plot Basics', engagement_value: lessonCompletedPoints(1800), related_id: ids.lesson })
  })

  it('never throws, and logs the failure, when the write is refused', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { from: () => { throw new Error('boom') } } as never
    await expect(recordLessonCompleted(createRepos(broken), { memberId: ids.member, lessonId: ids.lesson, courseId: ids.course, lessonTitle: 'x', lessonSeconds: null })).resolves.toBeUndefined()
    await expect(recordLessonWatched(createRepos(broken), { memberId: ids.member, lessonId: ids.lesson, courseId: ids.course, lessonTitle: 'x', videoId: ids.video, lessonSeconds: 1 })).resolves.toBeUndefined()
    const refused = { from: () => ({ insert: async () => ({ error: { code: '42501', message: 'denied' } }) }) } as never
    await recordLessonCompleted(createRepos(refused), { memberId: ids.member, lessonId: ids.lesson, courseId: ids.course, lessonTitle: 'x', lessonSeconds: null })
    expect(spy).toHaveBeenCalledTimes(3)
    spy.mockRestore()
  })
})
