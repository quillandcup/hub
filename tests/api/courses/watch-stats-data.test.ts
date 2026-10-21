import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { loadCourseWatchStats } from '@/lib/courses/watch-stats-data'

/**
 * What the staff watch-stats pages read, against the real local database: each lesson's video, the
 * segments members left, and staff viewing set aside. Rows are created under a run-unique slug and
 * cleaned up by cascade from the course.
 */

const ts = Date.now()
const SLUG = `watch-stats-${ts}`
const emailOf = (who: string) => `watch-stats-${who}-${ts}@example.com`

describe('loadCourseWatchStats', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  let staffAuthId: string | null = null

  const segment = (who: string, video: string, start: number, end: number, over: Record<string, unknown> = {}) => ({
    // Every row has the same keys: a bulk insert needs that.
    member_id: ids[who], video_id: video, session_id: crypto.randomUUID(), start_seconds: start, end_seconds: end, playback_rate: 1, captions_language: null as string | null, ...over,
  })

  beforeAll(async () => {
    const { data: members, error } = await supabase
      .from('members')
      .insert(['ann', 'bea', 'staff'].map((who) => ({ name: `Watch Stats ${who}`, email: emailOf(who), joined_at: new Date().toISOString(), status: 'active' })))
      .select('id, email')
    expect(error).toBeNull()
    for (const who of ['ann', 'bea', 'staff']) ids[who] = members!.find((m) => m.email === emailOf(who))!.id

    // The staff member is an admin with an auth account, which is how the loader recognises staff.
    const { data: auth, error: authError } = await supabase.auth.admin.createUser({ email: emailOf('staff'), email_confirm: true })
    if (authError || !auth.user) throw new Error(`createUser failed: ${authError?.message}`)
    staffAuthId = auth.user.id
    await supabase.from('user_profiles').update({ role: 'admin' }).eq('id', staffAuthId)
    await supabase.from('members').update({ user_id: staffAuthId }).eq('id', ids.staff)

    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `Watch Stats ${ts}`, source_key: SLUG }).select('id').single()
    ids.course = course!.id
    const { data: videos } = await supabase
      .from('videos')
      .insert([
        { source_kind: 'upload', source_key: `${SLUG}-a`, status: 'ready', mux_playback_id: 'pb-a', duration_seconds: 100 },
        { source_kind: 'upload', source_key: `${SLUG}-b`, status: 'ready', mux_playback_id: 'pb-b', duration_seconds: 50 },
      ])
      .select('id, source_key')
    ids.videoA = videos!.find((v) => v.source_key === `${SLUG}-a`)!.id
    ids.videoB = videos!.find((v) => v.source_key === `${SLUG}-b`)!.id
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, title: 'One', position: 1, state: 'open', video_id: ids.videoA, source_key: `${SLUG}-1` },
        { course_id: ids.course, title: 'Two', position: 2, state: 'open', video_id: ids.videoB, source_key: `${SLUG}-2` },
        { course_id: ids.course, title: 'Three', position: 3, state: 'open', source_key: `${SLUG}-3` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[`lesson${l.title}`] = l.id

    const { error: segmentsError } = await supabase.from('video_watch_segments').insert([
      segment('ann', ids.videoA, 0, 100, { playback_rate: 1.5, captions_language: 'English' }),
      segment('ann', ids.videoA, 10, 30),
      segment('bea', ids.videoA, 0, 50),
      segment('staff', ids.videoA, 0, 100),
    ])
    expect(segmentsError).toBeNull()

    // Two visits where the player appeared and nothing was played (ann, bea), and a staff one.
    const marker = (who: string, userAgent: string | null) => ({
      member_id: ids[who], video_id: ids.videoA, session_id: crypto.randomUUID(), client_segment_id: crypto.randomUUID(), kind: 'viewed', start_seconds: 0, end_seconds: 0, user_agent: userAgent,
    })
    const { error: viewsError } = await supabase.from('video_watch_segments').insert([
      marker('ann', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Chrome/130.0 Safari/537.36'),
      marker('bea', null),
      marker('staff', null),
    ])
    expect(viewsError).toBeNull()
  })
  afterAll(async () => {
    await supabase.from('courses').delete().eq('id', ids.course)
    await supabase.from('videos').delete().in('id', [ids.videoA, ids.videoB])
    await supabase.from('members').delete().in('id', [ids.ann, ids.bea, ids.staff])
    if (staffAuthId) await supabase.auth.admin.deleteUser(staffAuthId)
  })

  it('is null for a course that is not in the Hub', async () => {
    expect(await loadCourseWatchStats(supabase, `no-such-${ts}`)).toBeNull()
  })

  it("gives each lesson's video stats in page order, with staff viewing left out", async () => {
    const result = await loadCourseWatchStats(supabase, SLUG)
    expect(result).not.toBeNull()
    expect(result!.course).toMatchObject({ title: `Watch Stats ${ts}`, slug: SLUG })
    expect(result!.staffExcluded).toBe(true)
    expect(result!.lessons.map((l) => l.lesson.title)).toEqual(['One', 'Two', 'Three'])

    const [one, two, three] = result!.lessons

    expect(one.videoId).toBe(ids.videoA)
    // The Mux playback id is there once the video is ready, for stills of it; each segment here is its own player session.
    expect(one.playbackId).toBe('pb-a')
    expect(one.stats!.plays).toBe(3)
    // Five visits (the three that played and the two that only opened the lesson), three of them played. A viewed marker is not a stretch.
    expect(one.stats).toMatchObject({ views: 5, playRate: 0.6 })
    expect(two.playbackId).toBe('pb-b')
    expect(three.playbackId).toBeNull()
    expect(one.stats).toMatchObject({ viewers: 2, durationSeconds: 100, watchedSeconds: 170, uniqueWatchedSeconds: 150 })
    expect(one.stats!.speeds).toEqual([{ rate: 1, seconds: 70 }, { rate: 1.5, seconds: 100 }].sort((a, b) => b.seconds - a.seconds))
    expect(one.stats!.captionsShare).toBeCloseTo(100 / 170)
    // Nobody watched the second video, and the third lesson has none.
    expect(two).toMatchObject({ videoId: ids.videoB, stats: null })
    expect(three).toMatchObject({ videoId: null, stats: null })
    expect(result!.viewers).toBe(2)
    expect(result!.watchedSeconds).toBe(170)
  })

  it('includes staff viewing on request', async () => {
    const result = await loadCourseWatchStats(supabase, SLUG, { includeStaff: true })
    expect(result!.staffExcluded).toBe(false)
    expect(result!.lessons[0].stats).toMatchObject({ viewers: 3, watchedSeconds: 270, plays: 4, views: 7 })
    expect(result!.viewers).toBe(3)
  })

  it('lists the visits with who and the device when asked, newest first, staff left out', async () => {
    const without = await loadCourseWatchStats(supabase, SLUG, { lessonId: ids.lessonOne })
    expect(without!.lessons[0].sessions).toEqual([])

    const result = await loadCourseWatchStats(supabase, SLUG, { lessonId: ids.lessonOne, withSessions: true })
    const sessions = result!.lessons[0].sessions
    expect(sessions).toHaveLength(5)
    expect(sessions.every((x) => ['Watch Stats ann', 'Watch Stats bea'].includes(x.memberName))).toBe(true)
    expect(sessions.filter((x) => x.played)).toHaveLength(3)
    expect(sessions.find((x) => x.userAgent?.includes('Macintosh'))).toMatchObject({ memberName: 'Watch Stats ann', played: false, coveredFraction: 0 })
    const times = sessions.map((x) => x.startedAt ?? '')
    expect(times).toEqual([...times].sort().reverse())
  })

  it('reads just one lesson when asked', async () => {
    const result = await loadCourseWatchStats(supabase, SLUG, { lessonId: ids.lessonOne })
    expect(result!.lessons).toHaveLength(1)
    expect(result!.lessons[0].lesson.id).toBe(ids.lessonOne)
    expect(result!.lessons[0].stats?.viewers).toBe(2)
    expect((await loadCourseWatchStats(supabase, SLUG, { lessonId: '00000000-0000-4000-a000-0000000000ff' }))!.lessons).toEqual([])
  })

  it('reads past the 1000-row cap', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => segment('ann', ids.videoB, i % 40, (i % 40) + 5))
    for (let i = 0; i < rows.length; i += 400) expect((await supabase.from('video_watch_segments').insert(rows.slice(i, i + 400))).error).toBeNull()
    const result = await loadCourseWatchStats(supabase, SLUG)
    expect(result!.lessons[1].stats!.watchedSeconds).toBe(1200 * 5)
  })
})
