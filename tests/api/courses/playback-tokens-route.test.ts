import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/courses/playback-tokens: fresh playback links for a lesson tab left open past the hour the page's links last,
 * against the real local database. Who is calling is faked; Mux signing is faked (it records what it was asked to sign).
 */

const ts = Date.now()
const SLUG = `playback-tokens-${ts}`
const emailOf = (who: string) => `playback-tokens-${who}-${ts}@example.com`

const caller = vi.hoisted(() => ({ current: null as null | { userId: string; identity: { memberId: string; isSudo: boolean }; scope: { memberId: string; isAdminActing: boolean } } }))
const restriction = vi.hoisted(() => ({ id: null as string | null, calls: [] as unknown[] }))
const signed = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }))
vi.mock('@/lib/courses/caller', () => ({ getCoursesCaller: async () => caller.current }))
vi.mock('@/lib/mux-restriction.server', () => ({
  restrictionIdForViewer: async (userId: string, identity: unknown) => {
    restriction.calls.push({ userId, identity })
    return restriction.id
  },
}))
vi.mock('@/lib/mux', () => ({
  createMuxClient: () => ({}),
  signPlaybackTokens: async (...args: unknown[]) => {
    signed.calls.push(args.slice(1))
    if (signed.fail) throw new Error('mux down')
    return { playback: 'tok-play', poster: 'tok-poster', storyboard: 'tok-board' }
  },
}))

describe('/api/courses/playback-tokens', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const userId = crypto.randomUUID()

  const post = (body: unknown) =>
    apiFetch(`${getTestApiBaseUrl()}/api/courses/playback-tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const actAs = (who: string, over: { isSudo?: boolean; isAdminActing?: boolean } = {}) => {
    caller.current = { userId, identity: { memberId: ids[who], isSudo: over.isSudo ?? false }, scope: { memberId: ids[who], isAdminActing: over.isAdminActing ?? false } }
  }

  beforeAll(async () => {
    const now = new Date()
    const { data: members } = await supabase
      .from('members')
      .insert(['current', 'ended'].map((who) => ({ name: `Playback Tokens ${who}`, email: emailOf(who), joined_at: now.toISOString(), status: 'active' })))
      .select('id, email')
    for (const who of ['current', 'ended']) ids[who] = members!.find((m) => m.email === emailOf(who))!.id

    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `Playback Tokens ${ts}`, source_key: SLUG }).select('id').single()
    ids.course = course!.id
    const { data: ready } = await supabase.from('videos').insert({ source_kind: 'upload', source_key: `${SLUG}-ready`, status: 'ready', mux_playback_id: 'pb-ready' }).select('id').single()
    const { data: preparing } = await supabase.from('videos').insert({ source_kind: 'upload', source_key: `${SLUG}-prep`, status: 'preparing' }).select('id').single()
    ids.ready = ready!.id
    ids.preparing = preparing!.id
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, title: 'A', position: 1, state: 'open', video_id: ids.ready, source_key: `${SLUG}-a` },
        { course_id: ids.course, title: 'Soon', position: 2, state: 'coming_soon', video_id: ids.ready, source_key: `${SLUG}-soon` },
        { course_id: ids.course, title: 'NoVideo', position: 3, state: 'open', source_key: `${SLUG}-nv` },
        { course_id: ids.course, title: 'Prep', position: 4, state: 'open', video_id: ids.preparing, source_key: `${SLUG}-prep` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[`lesson${l.title}`] = l.id
    await supabase.from('course_access').insert([
      { member_id: ids.current, course_id: ids.course, starts_at: new Date(now.getTime() - 10 * 86_400_000).toISOString(), ends_at: null, origin: 'purchase' },
      { member_id: ids.ended, course_id: ids.course, starts_at: new Date(now.getTime() - 500 * 86_400_000).toISOString(), ends_at: new Date(now.getTime() - 100 * 86_400_000).toISOString(), origin: 'purchase' },
    ])
  })
  afterAll(async () => {
    await supabase.from('rate_limit_counters').delete().eq('bucket', `course_playback_tokens:user:${userId}`)
    await supabase.from('courses').delete().eq('id', ids.course)
    await supabase.from('videos').delete().in('id', [ids.ready, ids.preparing])
    await supabase.from('members').delete().in('id', [ids.current, ids.ended])
  })
  beforeEach(async () => {
    await supabase.from('rate_limit_counters').delete().eq('bucket', `course_playback_tokens:user:${userId}`)
    signed.fail = false
    restriction.id = null
    restriction.calls = []
    signed.calls = []
    actAs('current')
  })

  it('rejects a malformed body, or a lesson id that is not one, with 400', async () => {
    const bad = await apiFetch(`${getTestApiBaseUrl()}/api/courses/playback-tokens`, { method: 'POST', body: '{nope' })
    expect(bad.status).toBe(400)
    expect((await post({ lessonId: 'abc' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect(signed.calls).toEqual([])
  })

  it('refuses a caller without the courses feature (or signed out) with 401', async () => {
    caller.current = null
    const response = await post({ lessonId: ids.lessonA })
    expect(response.status).toBe(401)
    expect(signed.calls).toEqual([])
  })

  it("returns the lesson's tokens, never cached, signed for that lesson's ready video", async () => {
    const response = await post({ lessonId: ids.lessonA })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ tokens: { playback: 'tok-play', poster: 'tok-poster', storyboard: 'tok-board' }, restricted: false })
    expect(signed.calls).toEqual([['pb-ready', undefined, null]])
  })

  it('adds the restriction claim by the same rule as the page, for the effective member in sudo', async () => {
    restriction.id = 'restriction-1'
    actAs('current', { isSudo: true })
    const response = await post({ lessonId: ids.lessonA })
    expect(await response.json()).toMatchObject({ restricted: true })
    expect(signed.calls).toEqual([['pb-ready', undefined, 'restriction-1']])
    expect(restriction.calls).toEqual([{ userId, identity: { memberId: ids.current, isSudo: true } }])
  })

  it('answers the same generic 404 for an unknown lesson, one without a ready video, or one the member cannot open yet', async () => {
    const bodies = []
    for (const lessonId of ['les_ZZZZZZZZZZZ1', ids.lessonNoVideo, ids.lessonPrep, ids.lessonSoon]) {
      const response = await post({ lessonId })
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('no-store')
      bodies.push(await response.json())
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
    expect(signed.calls).toEqual([])
  })

  it('lets staff acting as themselves open an unreleased lesson, but not in sudo', async () => {
    actAs('current', { isAdminActing: true })
    expect((await post({ lessonId: ids.lessonSoon })).status).toBe(200)
    actAs('current', { isSudo: true })
    expect((await post({ lessonId: ids.lessonSoon })).status).toBe(404)
  })

  it('answers 404 to a member whose access to the course has ended', async () => {
    actAs('ended')
    expect((await post({ lessonId: ids.lessonA })).status).toBe(404)
    expect(signed.calls).toEqual([])
  })

  it('answers 502 when Mux cannot sign', async () => {
    signed.fail = true
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await post({ lessonId: ids.lessonA })
    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')
    spy.mockRestore()
  })

  it('limits how often one user can ask', async () => {
    for (let i = 0; i < 10; i++) expect((await post({ lessonId: ids.lessonA })).status).toBe(200)
    const limited = await post({ lessonId: ids.lessonA })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('cache-control')).toBe('no-store')
  })
})
