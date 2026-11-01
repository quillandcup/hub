import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { planCourseVideos, refreshVideoStatuses, uploadCourseVideos, type CourseMuxApi } from '@/lib/courses/media'
import { createRepos } from "@/lib/data/repos";

/**
 * Step D against the real local database with a fake Mux: which videos are uploaded (only visible
 * lessons'), that nothing is uploaded twice, that a failure is retried into the same row, and that
 * statuses are brought up to date from Mux.
 */

const ts = Date.now()
const COURSE = `test-media-${ts}`
const M = (n: string) => `${COURSE}-m-${n}`
const media = (n: string) => `${COURSE}-media-${n}`
const NOW = new Date('2026-10-20T12:00:00Z')
const link = (n: string, expiresAt = '2026-10-25T00:00:00Z') => ({ download_url: `https://kajabi.test/${n}?sig=1`, download_url_expires_at: expiresAt })

const mux = {
  created: [] as { url: string; videoId: string; quality: string }[],
  failNext: false,
  statuses: {} as Record<string, { status: 'preparing' | 'ready' | 'errored'; durationSeconds?: number; playbackId?: string }>,
}
// Never reset: asset ids are unique in `videos`, and `mux.created` is cleared before every test.
let assetSeq = 0
const api: CourseMuxApi = {
  createAsset: vi.fn(async (opts) => {
    if (mux.failNext) {
      mux.failNext = false
      throw new Error('Mux said no')
    }
    mux.created.push(opts)
    return { assetId: `asset-${++assetSeq}-${ts}` }
  }),
  getAsset: vi.fn(async (assetId) => mux.statuses[assetId] ?? { status: 'preparing' as const }),
}
const fingerprint = async (url: string) => `fp:${url}`

describe('Course media step', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')

  async function cleanup() {
    await supabase.from('videos').delete().like('source_key', `${COURSE}-%`)
    await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_course_modules').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_courses').delete().eq('kajabi_id', COURSE)
  }
  const videoRows = async () => (await supabase.from('videos').select('*').like('source_key', `${COURSE}-%`)).data ?? []

  beforeAll(async () => {
    await cleanup()
    await bronze.from('kajabi_courses').insert({ kajabi_id: COURSE, title: 'Media Course', raw_payload: {} })
    await bronze.from('kajabi_course_modules').insert([
      { kajabi_id: M('open'), course_kajabi_id: COURSE, position: 1, title: 'Open', publishing_option: 'published' },
      { kajabi_id: M('draft'), course_kajabi_id: COURSE, position: 2, title: 'Draft', publishing_option: 'draft' },
    ])
    const lesson = (n: string, module: string, over: Record<string, unknown> = {}) => ({
      kajabi_id: `${COURSE}-l-${n}`,
      course_kajabi_id: COURSE,
      module_kajabi_id: M(module),
      position: 1,
      title: `Lesson ${n}`,
      publishing_option: 'published',
      video_duration_seconds: 600,
      ...over,
    })
    await bronze.from('kajabi_course_lessons').insert([
      lesson('a', 'open', { video_media_id: media('a'), video_source: link('a') }),
      // The same video in two lessons is one upload.
      lesson('a2', 'open', { video_media_id: media('a'), video_source: link('a') }),
      lesson('b', 'open', { video_media_id: media('b'), video_source: link('b', '2026-10-20T12:02:00Z') }), // expires in 2 minutes
      lesson('c', 'open', { video_media_id: media('c'), video_source: { download_url: null, download_url_expires_at: null } }),
      lesson('draft', 'open', { publishing_option: 'draft', video_media_id: media('draft'), video_source: link('draft') }),
      lesson('indraftmodule', 'draft', { video_media_id: media('indraft'), video_source: link('indraft') }),
      lesson('novideo', 'open'),
    ])
  })
  afterAll(cleanup)
  beforeEach(() => {
    mux.created = []
    mux.failNext = false
    vi.mocked(api.createAsset).mockClear()
  })

  it('plans the videos of visible lessons and, marked as drafts, the ones only drafts use, with what each needs', async () => {
    const plan = await planCourseVideos(createRepos(supabase), COURSE, NOW)
    const byMedia = Object.fromEntries(plan.map((p) => [p.mediaId, p]))

    expect(Object.keys(byMedia).sort()).toEqual([media('a'), media('b'), media('c'), media('draft'), media('indraft')])
    expect(byMedia[media('a')]).toMatchObject({ draft: false, state: 'ready_to_upload', lessonTitles: ['Lesson a', 'Lesson a2'], durationSeconds: 600 })
    expect(byMedia[media('b')]).toMatchObject({ draft: false, state: 'link_expired' })
    expect(byMedia[media('c')]).toMatchObject({ draft: false, state: 'no_link' })
    // A draft lesson's video, and one under a draft module, are planned for staff previews but flagged.
    expect(byMedia[media('draft')]).toMatchObject({ draft: true, state: 'ready_to_upload' })
    expect(byMedia[media('indraft')]).toMatchObject({ draft: true, state: 'ready_to_upload' })
  })

  it('uploads a video once, recording the video, its fingerprint and the Mux asset', async () => {
    const result = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint)

    expect(result.uploaded).toHaveLength(1)
    expect(result.alreadyInMux).toBe(0)
    expect(mux.created).toHaveLength(1)
    expect(mux.created[0]).toMatchObject({ url: `https://kajabi.test/a?sig=1`, quality: 'plus' })

    const [video] = await videoRows()
    expect(video).toMatchObject({
      source_kind: 'kajabi',
      source_key: media('a'),
      status: 'preparing',
      quality: 'plus',
      has_burned_in_captions: true,
      source_fingerprint: 'fp:https://kajabi.test/a?sig=1',
      mux_asset_id: result.uploaded[0].assetId,
    })
    // Mux gets our video id back as passthrough, so its webhook can be traced even before the asset id is saved.
    expect(mux.created[0].videoId).toBe(video.id)
  })

  it('reports videos that need a fresh link instead of uploading them', async () => {
    const result = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint)

    expect(result.needsNewLink).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mediaId: media('b'), reason: 'expired' }),
        expect.objectContaining({ mediaId: media('c'), reason: 'missing' }),
      ])
    )
  })

  it('uploads nothing it has already uploaded', async () => {
    const before = (await videoRows()).length
    const result = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint)

    expect(result.uploaded).toEqual([])
    expect(result.alreadyInMux).toBe(1)
    expect(api.createAsset).not.toHaveBeenCalled()
    expect((await videoRows()).length).toBe(before)
  })

  it('still uploads when the change check cannot reach the source (fingerprint left empty)', async () => {
    await supabase.from('videos').delete().eq('source_key', media('a'))
    const result = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, async () => {
      throw new Error('source answered 403')
    })

    expect(result.uploaded).toHaveLength(1)
    expect((await videoRows())[0].source_fingerprint).toBeNull()
  })

  it('marks a failed upload errored, then retries it into the same row', async () => {
    await supabase.from('videos').delete().eq('source_key', media('a'))
    mux.failNext = true
    const failed = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint)

    expect(failed.failed).toMatchObject([{ mediaId: media('a'), error: 'Mux said no' }])
    const [errored] = await videoRows()
    expect(errored).toMatchObject({ status: 'errored', mux_asset_id: null })

    const retried = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint)
    expect(retried.uploaded).toHaveLength(1)
    const rows = await videoRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: errored.id, status: 'preparing' })
  })

  it('brings statuses up to date from Mux: ready gets its playback id and length, preparing is left alone, errored is recorded', async () => {
    const [video] = await videoRows()
    mux.statuses[video.mux_asset_id] = { status: 'ready', durationSeconds: 601.5, playbackId: 'signed-pb' }
    let result = await refreshVideoStatuses(createRepos(supabase), api)
    expect(result.ready).toBeGreaterThanOrEqual(1)
    expect((await videoRows())[0]).toMatchObject({ status: 'ready', mux_playback_id: 'signed-pb', duration_seconds: 601.5 })

    // Nothing preparing for this course any more; a new preparing one that Mux still holds is left as it is.
    await supabase.from('videos').update({ status: 'preparing' }).eq('id', video.id)
    mux.statuses[video.mux_asset_id] = { status: 'preparing' }
    result = await refreshVideoStatuses(createRepos(supabase), api)
    expect(result.stillPreparing).toBeGreaterThanOrEqual(1)
    expect((await videoRows())[0].status).toBe('preparing')

    mux.statuses[video.mux_asset_id] = { status: 'errored' }
    result = await refreshVideoStatuses(createRepos(supabase), api)
    expect(result.errored).toBeGreaterThanOrEqual(1)
    expect((await videoRows())[0].status).toBe('errored')
  })

  it('plans an errored video for retry', async () => {
    const plan = await planCourseVideos(createRepos(supabase), COURSE, NOW)
    const a = plan.find((p) => p.mediaId === media('a'))!
    expect(a).toMatchObject({ state: 'ready_to_upload', videoStatus: 'errored' })
    expect(a.retryVideoId).toBeTruthy()
  })

  it('never uploads the videos only drafts use in the normal upload, and uploads exactly those when asked for drafts', async () => {
    const draftKeys = [media('draft'), media('indraft')]
    try {
      const normal = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint)
      // The normal upload may retry the visible lesson's errored video (the test before), but never a draft's.
      expect(normal.uploaded.every((u) => !draftKeys.includes(u.mediaId))).toBe(true)
      expect(await supabase.from('videos').select('id').in('source_key', draftKeys)).toMatchObject({ data: [] })
      const afterNormal = mux.created.length

      const drafts = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint, { drafts: true })
      expect(drafts.uploaded.map((u) => u.mediaId).sort()).toEqual([media('draft'), media('indraft')])
      // Only drafts: the visible lessons' videos aren't this action's business.
      expect(drafts.needsNewLink).toEqual([])
      expect(mux.created.length).toBe(afterNormal + 2)

      // Repeating it uploads nothing more.
      const again = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint, { drafts: true })
      expect(again.uploaded).toEqual([])
      expect(again.alreadyInMux).toBe(2)
    } finally {
      await supabase.from('videos').delete().in('source_key', draftKeys)
    }
  })
  it('uploads exactly the videos picked, and reports picks this upload does not cover', async () => {
    const draftKeys = [media('draft'), media('indraft')]
    try {
      const picked = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint, {
        drafts: true,
        mediaIds: [media('draft'), media('a'), `${COURSE}-nope`],
      })

      // One of the two drafts. A visible lesson's video and an unknown id aren't drafts, so they are reported, not uploaded.
      expect(picked.uploaded.map((u) => u.mediaId)).toEqual([media('draft')])
      expect(picked.notAvailable.sort()).toEqual([media('a'), `${COURSE}-nope`].sort())
      expect(mux.created).toHaveLength(1)
      expect((await supabase.from('videos').select('id').eq('source_key', media('indraft'))).data).toEqual([])

      // Without a selection nothing is reported unavailable and every draft still left is considered.
      const rest = await uploadCourseVideos(createRepos(supabase), api, COURSE, NOW, fingerprint, { drafts: true })
      expect(rest.notAvailable).toEqual([])
      expect(rest.uploaded.map((u) => u.mediaId)).toEqual([media('indraft')])
      expect(rest.alreadyInMux).toBe(1)
    } finally {
      await supabase.from('videos').delete().in('source_key', draftKeys)
    }
  })
})
