import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/process/course-media: the admin's explicit "upload videos to Mux" and "update status"
 * actions. Real database, fake Mux; the lesson ends up linked to its video.
 */

const ts = Date.now()
const COURSE = `test-cm-${ts}`
const SLUG = `cm-course-${ts}`
const MEDIA = `${COURSE}-media`

const mux = vi.hoisted(() => ({ created: 0, ready: false }))
vi.mock('@/lib/mux', () => ({
  createMuxClient: () => ({}),
  courseMuxApi: () => ({
    createAsset: async () => ({ assetId: `asset-${++mux.created}` }),
    // Only this test's own asset ever turns ready, so videos from other tests sharing the database are left alone.
    getAsset: async (assetId: string) => (mux.ready && assetId === 'asset-1' ? { status: 'ready', durationSeconds: 90, playbackId: 'signed-pb' } : { status: 'preparing' }),
  }),
}))

describe('/api/process/course-media', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')

  const post = (body: unknown, headers: Record<string, string> = getTestAuthHeaders()) =>
    apiFetch(`${getTestApiBaseUrl()}/api/process/course-media`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE)
    await supabase.from('videos').delete().eq('source_key', MEDIA)
    await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_courses').delete().eq('kajabi_id', COURSE)
  }

  beforeAll(async () => {
    // Only the one-byte source check is faked; the database client keeps using the real fetch.
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (typeof input === 'string' && input.startsWith('https://kajabi.test')) {
        return new Response(null, { status: 206, headers: { 'content-range': 'bytes 0-0/1234', etag: '"e"', 'last-modified': 'Mon' } })
      }
      return realFetch(input, init)
    })
    await cleanup()
    await bronze.from('kajabi_courses').insert({ kajabi_id: COURSE, title: `CM Course ${ts}`, raw_payload: { attributes: { title: `CM Course ${ts}` } } })
    await bronze.from('kajabi_course_lessons').insert({
      kajabi_id: `${COURSE}-l`,
      course_kajabi_id: COURSE,
      position: 1,
      title: 'L',
      publishing_option: 'published',
      video_media_id: MEDIA,
      video_duration_seconds: 90,
      video_source: { download_url: 'https://kajabi.test/video?sig=1', download_url_expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString() },
    })
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    await cleanup()
  })
  beforeEach(() => {
    vi.stubEnv('MUX_TOKEN_ID', 'id')
    vi.stubEnv('MUX_TOKEN_SECRET', 'secret')
  })

  it('refuses without credentials, a bad body, an unknown action, or Mux not configured', async () => {
    expect((await apiFetch(`${getTestApiBaseUrl()}/api/process/course-media`, { method: 'POST' })).status).toBe(401)
    const bad = await apiFetch(`${getTestApiBaseUrl()}/api/process/course-media`, { method: 'POST', headers: getTestAuthHeaders(), body: '{nope' })
    expect(bad.status).toBe(400)
    expect((await post({ course: SLUG, action: 'delete' })).status).toBe(400)
    expect((await post({ action: 'upload' })).status).toBe(400)

    vi.stubEnv('MUX_TOKEN_ID', '')
    const unconfigured = await post({ course: SLUG, action: 'upload' })
    expect(unconfigured.status).toBe(503)
    expect((await unconfigured.json()).error).toMatch(/Mux isn't configured/)
  })

  it('is a 404 for a course that is not published', async () => {
    expect((await post({ course: `no-such-${ts}`, action: 'upload' })).status).toBe(404)
  })

  it('uploads the lesson video, links the lesson to it, and uploads nothing again', async () => {
    // Publish first (step C), which is what makes the slug exist.
    const publish = await apiFetch(`${getTestApiBaseUrl()}/api/process/courses`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ course: SLUG }),
    })
    expect(publish.status).toBe(200)

    const response = await post({ course: SLUG, action: 'upload' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.upload.uploaded).toHaveLength(1)
    expect(body.refresh.stillPreparing).toBeGreaterThanOrEqual(1)

    const video = (await supabase.from('videos').select('id, status, mux_asset_id').eq('source_key', MEDIA).single()).data!
    expect(video).toMatchObject({ status: 'preparing', mux_asset_id: 'asset-1' })
    const course = (await supabase.from('courses').select('id').eq('source_key', COURSE).single()).data!
    const lesson = (await supabase.from('course_lessons').select('video_id').eq('course_id', course.id).single()).data!
    expect(lesson.video_id).toBe(video.id)

    const again = await (await post({ course: SLUG, action: 'upload' })).json()
    expect(again.upload.uploaded).toEqual([])
    expect(again.upload.alreadyInMux).toBe(1)
    expect(mux.created).toBe(1)
  })

  it('"refresh" only brings statuses up to date', async () => {
    mux.ready = true
    const response = await post({ course: SLUG, action: 'refresh' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.upload).toBeUndefined()
    expect(body.refresh.ready).toBeGreaterThanOrEqual(1)
    expect((await supabase.from('videos').select('status, mux_playback_id').eq('source_key', MEDIA).single()).data).toEqual({ status: 'ready', mux_playback_id: 'signed-pb' })
  })
})
