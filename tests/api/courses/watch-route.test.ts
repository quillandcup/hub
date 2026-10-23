import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/courses/watch: what the lesson player saves (watch segments and the resume position),
 * against the real local database. Who is calling is faked (the caller and the member-scoped
 * client); that RLS lets a member write only their own rows is covered by supabase/tests/database/courses.test.sql.
 */

const ts = Date.now()
const SLUG = `watch-route-${ts}`
const emailOf = (who: string) => `watch-route-${who}-${ts}@example.com`

const caller = vi.hoisted(() => ({ current: null as null | { identity: { memberId: string; isSudo: boolean }; scope: { memberId: string; isAdminActing: boolean } } }))
vi.mock('@/lib/courses/caller', () => ({ getCoursesCaller: async () => caller.current }))
vi.mock('@/lib/supabase/server', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return { createClient: async () => getTestSupabaseAdminClient() }
})

describe('/api/courses/watch', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const sessionId = '00000000-0000-4000-a000-00000000c999'
  const newId = () => crypto.randomUUID()
  const segment = { id: newId(), start: 0, end: 30, rate: 1.25, captions: 'English', visible: true }

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    apiFetch(`${getTestApiBaseUrl()}/api/courses/watch`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const body = (over: Record<string, unknown> = {}) => ({ lessonId: ids.lessonA, sessionId, segments: [segment], position: 30, ...over })
  const actAs = (who: string, over: { isSudo?: boolean; isAdminActing?: boolean } = {}) => {
    caller.current = { identity: { memberId: ids[who], isSudo: over.isSudo ?? false }, scope: { memberId: ids[who], isAdminActing: over.isAdminActing ?? false } }
  }
  const segmentsOf = async (who: string) => (await supabase.from('video_watch_segments').select('*').eq('member_id', ids[who])).data ?? []
  const progressOf = async (who: string, lesson: string) => (await supabase.from('lesson_progress').select('*').eq('member_id', ids[who]).eq('lesson_id', lesson).maybeSingle()).data

  beforeAll(async () => {
    const now = new Date()
    const { data: members } = await supabase
      .from('members')
      .insert(['current', 'ended'].map((who) => ({ name: `Watch Route ${who}`, email: emailOf(who), joined_at: now.toISOString(), status: 'active' })))
      .select('id, email')
    for (const who of ['current', 'ended']) ids[who] = members!.find((m) => m.email === emailOf(who))!.id

    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `Watch Route ${ts}`, source_key: SLUG }).select('id').single()
    ids.course = course!.id
    const { data: video } = await supabase.from('videos').insert({ source_kind: 'upload', source_key: SLUG, status: 'ready', mux_playback_id: 'pb-watch' }).select('id').single()
    ids.video = video!.id
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, title: 'A', position: 1, state: 'open', video_id: ids.video, source_key: `${SLUG}-a` },
        { course_id: ids.course, title: 'Soon', position: 2, state: 'coming_soon', video_id: ids.video, source_key: `${SLUG}-soon` },
        { course_id: ids.course, title: 'NoVideo', position: 3, state: 'open', source_key: `${SLUG}-nv` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[`lesson${l.title}`] = l.id
    await supabase.from('course_access').insert([
      { member_id: ids.current, course_id: ids.course, starts_at: new Date(now.getTime() - 10 * 86_400_000).toISOString(), ends_at: null, origin: 'purchase' },
      { member_id: ids.ended, course_id: ids.course, starts_at: new Date(now.getTime() - 500 * 86_400_000).toISOString(), ends_at: new Date(now.getTime() - 100 * 86_400_000).toISOString(), origin: 'purchase' },
    ])
  })
  afterAll(async () => {
    await supabase.from('courses').delete().eq('id', ids.course)
    await supabase.from('videos').delete().eq('id', ids.video)
    await supabase.from('members').delete().in('id', [ids.current, ids.ended])
  })
  beforeEach(async () => {
    await supabase.from('video_watch_segments').delete().in('member_id', [ids.current, ids.ended])
    await supabase.from('lesson_progress').delete().in('member_id', [ids.current, ids.ended])
    await supabase.from('member_activities').delete().in('member_id', [ids.current, ids.ended]).eq('source', 'courses')
    actAs('current')
  })

  it('rejects a malformed body with 400', async () => {
    const bad = await apiFetch(`${getTestApiBaseUrl()}/api/courses/watch`, { method: 'POST', body: '{nope' })
    expect(bad.status).toBe(400)
    expect((await post(body({ segments: [{ ...segment, end: -1 }] }))).status).toBe(400)
    expect((await post(body({ lessonId: 'abc' }))).status).toBe(400)
  })

  it('refuses a caller without the courses feature', async () => {
    caller.current = null
    expect((await post(body())).status).toBe(401)
    expect(await segmentsOf('current')).toEqual([])
  })

  it("saves the segments against the lesson's own video, and the position for resume", async () => {
    const response = await post(body({ segments: [segment, { ...segment, id: newId(), start: 40, end: 55, captions: null, visible: false }], position: 55 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ saved: 2 })

    const rows = await segmentsOf('current')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.video_id === ids.video && r.session_id === sessionId)).toBe(true)
    expect(rows.find((r) => r.start_seconds === '40' || r.start_seconds === 40)).toMatchObject({ end_seconds: 55, captions_language: null, visible: false })
    expect(await progressOf('current', ids.lessonA)).toMatchObject({ last_position_seconds: 55, completed_at: null })
  })

  it('logs the lesson as watched in the activity log once a day of watching is long enough, and only once a day', async () => {
    const activitiesOf = async () => (await supabase.from('member_activities').select('*').eq('member_id', ids.current).eq('source', 'courses')).data ?? []
    await post(body({ segments: [{ ...segment, id: newId(), start: 0, end: 60 }] }))
    expect(await activitiesOf()).toEqual([])
    expect((await post(body({ segments: [{ ...segment, id: newId(), start: 60, end: 400 }] }))).status).toBe(200)
    expect(await post(body({ segments: [{ ...segment, id: newId(), start: 400, end: 450 }] })).then((r) => r.status)).toBe(200)
    const rows = await activitiesOf()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ activity_type: 'lesson_watched', title: 'Watched A', data: { lesson_id: ids.lessonA, course_id: ids.course } })
  })

  it("doesn't log a staff preview of a lesson members can't open yet", async () => {
    actAs('current', { isAdminActing: true })
    await post(body({ lessonId: ids.lessonSoon, segments: [{ ...segment, id: newId(), start: 0, end: 400 }] }))
    expect((await supabase.from('member_activities').select('id').eq('member_id', ids.current).eq('source', 'courses')).data).toEqual([])
  })

  it('stores a resent segment once', async () => {
    const first = { ...segment, id: newId() }
    expect(await (await post(body({ segments: [first] }))).json()).toEqual({ saved: 1 })
    // The same save again (its first response was lost), now with a new stretch after it.
    const second = { ...segment, id: newId(), start: 60, end: 70 }
    expect(await (await post(body({ segments: [first, second] }))).json()).toEqual({ saved: 1 })
    expect(await (await post(body({ segments: [first, second] }))).json()).toEqual({ saved: 0 })
    expect((await segmentsOf('current')).map((r) => Number(r.start_seconds)).sort((a, b) => a - b)).toEqual([0, 60])
  })

  it('records a viewed marker when the player appears, once per session, with the device', async () => {
    const marker = body({ segments: [], position: null, viewed: true })
    const agent = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36' }
    expect((await post(marker, agent)).status).toBe(200)
    // Resent (the first response was lost, or a later save carries it too): still one marker.
    expect((await post(marker, agent)).status).toBe(200)
    expect((await post(body({ viewed: true }), agent)).status).toBe(200)

    const rows = await segmentsOf('current')
    const viewed = rows.filter((r) => r.kind === 'viewed')
    expect(viewed).toHaveLength(1)
    expect(viewed[0]).toMatchObject({ video_id: ids.video, session_id: sessionId, client_segment_id: sessionId, user_agent: agent['user-agent'] })
    expect(Number(viewed[0].start_seconds)).toBe(0)
    expect(Number(viewed[0].end_seconds)).toBe(0)
    // The marker is not a stretch, and it moves no position.
    expect(rows.filter((r) => r.kind === 'watched')).toHaveLength(1)
    expect(await progressOf('current', ids.lessonA)).toMatchObject({ last_position_seconds: 30 })
  })

  it('records no marker in sudo, and none for a lesson the member cannot open', async () => {
    actAs('current', { isSudo: true })
    await post(body({ segments: [], position: null, viewed: true }))
    actAs('ended')
    expect((await post(body({ segments: [], position: null, viewed: true }))).status).toBe(403)
    expect(await segmentsOf('current')).toEqual([])
    expect(await segmentsOf('ended')).toEqual([])
  })

  it('moves the position without touching completion', async () => {
    const completedAt = new Date().toISOString()
    await supabase.from('lesson_progress').insert({ member_id: ids.current, lesson_id: ids.lessonA, completed_at: completedAt, last_position_seconds: 5 })
    expect((await post(body({ segments: [], position: 77 }))).status).toBe(200)
    const row = await progressOf('current', ids.lessonA)
    expect(row?.last_position_seconds).toBe(77)
    expect(new Date(row!.completed_at!).toISOString()).toBe(completedAt)
    expect(await segmentsOf('current')).toEqual([])
  })

  it('writes nothing in sudo', async () => {
    actAs('current', { isSudo: true })
    const response = await post(body())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ saved: 0 })
    expect(await segmentsOf('current')).toEqual([])
    expect(await progressOf('current', ids.lessonA)).toBeNull()
  })

  it('lets staff acting as themselves record a lesson members cannot open yet, into their own rows', async () => {
    actAs('current', { isAdminActing: true })
    const response = await post(body({ lessonId: ids.lessonSoon }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ saved: 1 })
    expect(await segmentsOf('current')).toHaveLength(1)
    // Still nothing in sudo, and still no lesson without a video.
    actAs('current', { isAdminActing: false, isSudo: true })
    expect(await (await post(body({ lessonId: ids.lessonSoon }))).json()).toMatchObject({ saved: 0 })
    actAs('current', { isAdminActing: true })
    expect((await post(body({ lessonId: ids.lessonNoVideo }))).status).toBe(404)
  })

  it("doesn't track a lesson that is still coming soon, one without a video, or an unknown one", async () => {
    expect((await post(body({ lessonId: ids.lessonSoon }))).status).toBe(404)
    expect((await post(body({ lessonId: ids.lessonNoVideo }))).status).toBe(404)
    expect((await post(body({ lessonId: 'les_AAAAAAAAAAff' }))).status).toBe(404)
    expect(await segmentsOf('current')).toEqual([])
  })

  it('refuses a member whose access to the course has ended', async () => {
    actAs('ended')
    expect((await post(body())).status).toBe(403)
    expect(await segmentsOf('ended')).toEqual([])
  })
})
