import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * The actions that upload, check on and take off the video of a Hub-owned lesson, against the real database.
 * Who is calling and Mux are faked: what is tested is who may do it, what is written (the video's row, the
 * lesson's link and length) and what is said when Mux or the database refuses.
 */

const ts = Date.now()
const PREFIX = `test-lvideo-${ts}`

const auth = vi.hoisted(() => ({ admin: true, failWrites: false, userId: 'user-admin' }))
vi.mock('@/lib/admin-auth', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  // A client that reads as usual and fails when the lesson is written.
  const failingWrites = (client: ReturnType<typeof getTestSupabaseAdminClient>) =>
    new Proxy(client, { get: (target, prop) => (prop === 'from' ? (table: string) => (table === 'course_lessons' ? { select: (...a: unknown[]) => (target.from(table) as any).select(...a), update: () => { throw new Error('connection lost') } } : target.from(table)) : (target as any)[prop]) })
  return {
    requireAdminAction: async () => (auth.admin ? { ok: true, user: { id: auth.userId, email: 'admin@example.test' }, supabase: auth.failWrites ? failingWrites(getTestSupabaseAdminClient()) : getTestSupabaseAdminClient() } : { ok: false, error: 'Not authorized' }),
  }
})
vi.mock('@/lib/analytics/server', () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))
const mux = vi.hoisted(() => ({
  createDirectUpload: vi.fn(),
  getUploadStatus: vi.fn(),
  getAssetStatus: vi.fn(),
  signThumbnailTokens: vi.fn(),
}))
vi.mock('@/lib/mux', () => ({ createMuxClient: () => ({}), ...mux }))

import sharp from 'sharp'
import { refreshLessonVideo, removeLessonVideo, setLessonThumbnailFromVideo, startLessonVideoUpload } from '@/app/(admin)/admin/courses/lesson-video-actions'

describe('Lesson video actions', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const created: string[] = []
  const lessonRow = async (id: string) => (await supabase.from('course_lessons').select('video_id, duration_seconds').eq('id', id).single()).data!
  const videoRow = async (id: string) => (await supabase.from('videos').select('*').eq('id', id).single()).data!
  const nextUpload = () => `${PREFIX}-up-${created.length}`

  beforeAll(async () => {
    // The admin who makes a library image is recorded on it, so they have to be a real user.
    const { data: user } = await supabase.auth.admin.createUser({ email: `${PREFIX}@example.test`, email_confirm: true })
    auth.userId = user.user!.id
    const insertCourse = async (slug: string, source: string) => (await supabase.from('courses').insert({ slug: `${PREFIX}-${slug}`, title: slug, source, ...(source === 'kajabi' ? { source_key: `${PREFIX}-${slug}` } : {}) }).select('id').single()).data!.id
    ids.hub = await insertCourse('hub', 'hub')
    ids.other = await insertCourse('other', 'hub')
    ids.kajabi = await insertCourse('kajabi', 'kajabi')
    ids.lesson = (await supabase.from('course_lessons').insert({ course_id: ids.hub, title: 'Lesson', position: 1, publishing_option: 'draft', source: 'hub' }).select('id').single()).data!.id
    ids.kajabiLesson = (await supabase.from('course_lessons').insert({ course_id: ids.kajabi, title: 'Imported', position: 1, publishing_option: 'published', state: 'open', source: 'kajabi', source_key: `${PREFIX}-l` }).select('id').single()).data!.id
  })
  beforeEach(() => {
    auth.admin = true
    vi.clearAllMocks()
  })
  afterAll(async () => {
    await supabase.from('courses').delete().like('slug', `${PREFIX}%`)
    await supabase.from('videos').delete().like('source_key', `${PREFIX}%`)
    await supabase.from('media_assets').delete().eq('created_by', auth.userId)
    await supabase.auth.admin.deleteUser(auth.userId)
  })

  /** Starts an upload as the browser would and returns the video row it made. */
  const start = async () => {
    const uploadId = nextUpload()
    created.push(uploadId)
    mux.createDirectUpload.mockResolvedValueOnce({ uploadId, url: `https://storage.example/${uploadId}` })
    const result = await startLessonVideoUpload(ids.hub, ids.lesson)
    return { uploadId, result }
  }

  describe('startLessonVideoUpload', () => {
    it('gives the address to send the file to, makes the video row of that upload, and points the lesson at it', async () => {
      const { uploadId, result } = await start()

      expect(result).toEqual({ url: `https://storage.example/${uploadId}` })
      expect(mux.createDirectUpload).toHaveBeenCalledWith(expect.anything(), { corsOrigin: expect.stringMatching(/^https?:\/\//), quality: 'plus' })
      const lesson = await lessonRow(ids.lesson)
      expect(await videoRow(lesson.video_id)).toMatchObject({ source_kind: 'upload', source_key: uploadId, status: 'preparing', mux_asset_id: null, quality: 'plus' })
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.hub}/lessons/${ids.lesson}`)
    })

    it('says so when Mux refuses, and changes nothing', async () => {
      const before = await lessonRow(ids.lesson)
      mux.createDirectUpload.mockRejectedValueOnce(new Error('mux down'))

      expect(await startLessonVideoUpload(ids.hub, ids.lesson)).toEqual({ error: "Couldn't start the upload." })
      expect(await lessonRow(ids.lesson)).toEqual(before)
    })

    it("won't start one for another course's lesson, an imported course's, a missing one, or a bad id", async () => {
      const notEditable = { error: expect.stringMatching(/can't be edited here/) }
      expect(await startLessonVideoUpload(ids.other, ids.lesson)).toEqual(notEditable)
      expect(await startLessonVideoUpload(ids.kajabi, ids.kajabiLesson)).toEqual(notEditable)
      expect(await startLessonVideoUpload(ids.hub, 'les_AAAAAAAAAAA1')).toEqual(notEditable)
      expect(await startLessonVideoUpload('nope', ids.lesson)).toEqual(notEditable)
      expect(mux.createDirectUpload).not.toHaveBeenCalled()
    })

    it("does nothing for someone who isn't an admin", async () => {
      auth.admin = false
      expect(await startLessonVideoUpload(ids.hub, ids.lesson)).toEqual({ error: 'Not authorized' })
      expect(mux.createDirectUpload).not.toHaveBeenCalled()
    })
  })

  describe('refreshLessonVideo', () => {
    it('says there is no video for a lesson without one', async () => {
      await removeLessonVideo(ids.hub, ids.lesson)
      expect(await refreshLessonVideo(ids.hub, ids.lesson)).toEqual({ status: 'none' })
      expect(mux.getUploadStatus).not.toHaveBeenCalled()
    })

    it('says it is waiting while the file has not arrived', async () => {
      await start()
      mux.getUploadStatus.mockResolvedValueOnce({ status: 'waiting' })

      expect(await refreshLessonVideo(ids.hub, ids.lesson)).toEqual({ status: 'waiting' })
      expect(mux.getAssetStatus).not.toHaveBeenCalled()
    })

    it('records the asset once the file is complete, then the video as preparing', async () => {
      await start()
      mux.getUploadStatus.mockResolvedValueOnce({ status: 'asset_created', assetId: `${PREFIX}-asset-a` })
      mux.getAssetStatus.mockResolvedValueOnce({ status: 'preparing' })

      expect(await refreshLessonVideo(ids.hub, ids.lesson)).toEqual({ status: 'preparing' })
      expect(await videoRow((await lessonRow(ids.lesson)).video_id)).toMatchObject({ mux_asset_id: `${PREFIX}-asset-a`, status: 'preparing' })
    })

    it('marks the video ready with its playback id and length, and gives the length to the lesson', async () => {
      await start()
      mux.getUploadStatus.mockResolvedValueOnce({ status: 'asset_created', assetId: `${PREFIX}-asset-b` })
      mux.getAssetStatus.mockResolvedValueOnce({ status: 'ready', playbackId: 'signed-pb', durationSeconds: 90.4 })

      expect(await refreshLessonVideo(ids.hub, ids.lesson)).toEqual({ status: 'ready' })
      const lesson = await lessonRow(ids.lesson)
      expect(await videoRow(lesson.video_id)).toMatchObject({ status: 'ready', mux_playback_id: 'signed-pb' })
      expect(lesson.duration_seconds).toBe(90)

      // Asking again skips the upload and just reads the asset.
      mux.getAssetStatus.mockResolvedValueOnce({ status: 'ready', playbackId: 'signed-pb', durationSeconds: 90.4 })
      expect(await refreshLessonVideo(ids.hub, ids.lesson)).toEqual({ status: 'ready' })
      expect(mux.getUploadStatus).toHaveBeenCalledTimes(1)
    })

    it('marks the video failed when the upload did', async () => {
      await start()
      mux.getUploadStatus.mockResolvedValueOnce({ status: 'failed' })

      expect(await refreshLessonVideo(ids.hub, ids.lesson)).toEqual({ status: 'errored' })
      expect((await videoRow((await lessonRow(ids.lesson)).video_id)).status).toBe('errored')
    })

    it('says so when Mux cannot be asked', async () => {
      await start()
      mux.getUploadStatus.mockRejectedValueOnce(new Error('mux down'))

      expect(await refreshLessonVideo(ids.hub, ids.lesson)).toEqual({ error: "Couldn't check on the video." })
    })

    it('leaves a video that has no upload to ask about as preparing', async () => {
      const { data: video } = await supabase.from('videos').insert({ source_kind: 'kajabi', source_key: `${PREFIX}-kajabi-media` }).select('id').single()
      await supabase.from('course_lessons').update({ video_id: video!.id }).eq('id', ids.lesson)

      expect(await refreshLessonVideo(ids.hub, ids.lesson)).toEqual({ status: 'preparing' })
      expect(mux.getUploadStatus).not.toHaveBeenCalled()
    })

    it("won't check on another course's lesson, an imported one, or for a non-admin", async () => {
      expect(await refreshLessonVideo(ids.other, ids.lesson)).toEqual({ error: expect.stringMatching(/can't be edited here/) })
      expect(await refreshLessonVideo(ids.kajabi, ids.kajabiLesson)).toEqual({ error: expect.stringMatching(/can't be edited here/) })
      auth.admin = false
      expect(await refreshLessonVideo(ids.hub, ids.lesson)).toEqual({ error: 'Not authorized' })
    })
  })

  describe('setLessonThumbnailFromVideo', () => {
    const realFetch = globalThis.fetch
    const thumb = async () => (await supabase.from('course_lessons').select('thumbnail_asset_id, thumbnail_url').eq('id', ids.lesson).single()).data!
    let still: Buffer
    let stillStatus = 200
    let requested: string[] = []

    beforeAll(async () => {
      // A real (tiny) picture, so the library can read what it is given.
      still = await sharp({ create: { width: 32, height: 18, channels: 3, background: { r: 120, g: 40, b: 160 } } }).jpeg().toBuffer()
    })
    beforeEach(async () => {
      stillStatus = 200
      requested = []
      mux.signThumbnailTokens.mockResolvedValue(['frame-token'])
      // Only the still is faked: the database and storage calls go to the real services.
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (!url.startsWith('https://image.mux.com/')) return realFetch(input, init)
        requested.push(url)
        return new Response(stillStatus === 200 ? new Uint8Array(still) : 'no', { status: stillStatus })
      })
      const { data: video } = await supabase.from('videos').insert({ source_kind: 'upload', source_key: `${PREFIX}-frame-${Math.random()}`, status: 'ready', mux_playback_id: 'pb-frame', mux_asset_id: `${PREFIX}-asset-frame-${Math.random()}` }).select('id').single()
      await supabase.from('course_lessons').update({ video_id: video!.id, thumbnail_asset_id: null, thumbnail_url: 'https://example.com/kajabi.jpg' }).eq('id', ids.lesson)
    })
    afterEach(() => {
      vi.stubGlobal('fetch', realFetch)
    })
    it('keeps the still of the video at that moment in the library and makes it the lesson\'s thumbnail', async () => {
      expect(await setLessonThumbnailFromVideo(ids.hub, ids.lesson, 75.34)).toEqual({ id: ids.lesson })

      expect(mux.signThumbnailTokens).toHaveBeenCalledWith(expect.anything(), 'pb-frame', [75.34], { width: 1280 })
      expect(requested).toEqual(['https://image.mux.com/pb-frame/thumbnail.jpg?token=frame-token'])
      const lesson = await thumb()
      expect(lesson.thumbnail_url).toBeNull()
      const { data: asset } = await supabase.from('media_assets').select('source, source_key, title, tags, width, height').eq('id', lesson.thumbnail_asset_id!).single()
      expect(asset).toMatchObject({ source: 'video_frame', title: 'Lesson at 1:15', tags: ['lesson thumbnail'], width: 32, height: 18 })
      expect(asset!.source_key).toMatch(/@75\.3$/)
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.hub}/lessons/${ids.lesson}`)
    })

    it('uses the same library image for the same frame twice', async () => {
      await setLessonThumbnailFromVideo(ids.hub, ids.lesson, 10)
      const first = (await thumb()).thumbnail_asset_id
      await setLessonThumbnailFromVideo(ids.hub, ids.lesson, 10)
      expect((await thumb()).thumbnail_asset_id).toBe(first)
    })

    it('says so when Mux has no still, and changes nothing', async () => {
      stillStatus = 404
      expect(await setLessonThumbnailFromVideo(ids.hub, ids.lesson, 5)).toEqual({ error: "Couldn't use that frame." })
      expect((await thumb()).thumbnail_url).toBe('https://example.com/kajabi.jpg')
    })

    it('says so when what Mux sent is not a picture', async () => {
      still = Buffer.from('not an image')
      expect((await setLessonThumbnailFromVideo(ids.hub, ids.lesson, 5)).error).toBeTruthy()
      expect((await thumb()).thumbnail_asset_id).toBeNull()
      still = await sharp({ create: { width: 32, height: 18, channels: 3, background: { r: 120, g: 40, b: 160 } } }).jpeg().toBuffer()
    })

    it('says so when the lesson has no video, or it is not ready', async () => {
      await supabase.from('videos').update({ status: 'preparing' }).eq('id', (await supabase.from('course_lessons').select('video_id').eq('id', ids.lesson).single()).data!.video_id!)
      expect(await setLessonThumbnailFromVideo(ids.hub, ids.lesson, 5)).toEqual({ error: "The video isn't ready yet." })
      await supabase.from('course_lessons').update({ video_id: null }).eq('id', ids.lesson)
      expect(await setLessonThumbnailFromVideo(ids.hub, ids.lesson, 5)).toEqual({ error: 'This lesson has no video.' })
    })

    it("refuses a moment that isn't one, another course's lesson, an imported one, and a non-admin", async () => {
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 24 * 3600 + 1]) expect(await setLessonThumbnailFromVideo(ids.hub, ids.lesson, bad)).toEqual({ error: "That isn't a moment in the video." })
      expect(await setLessonThumbnailFromVideo(ids.other, ids.lesson, 5)).toEqual({ error: expect.stringMatching(/can't be edited here/) })
      expect(await setLessonThumbnailFromVideo(ids.kajabi, ids.kajabiLesson, 5)).toEqual({ error: expect.stringMatching(/can't be edited here/) })
      auth.admin = false
      expect(await setLessonThumbnailFromVideo(ids.hub, ids.lesson, 5)).toEqual({ error: 'Not authorized' })
      expect(requested).toEqual([])
    })
  })

  describe('removeLessonVideo', () => {
    it('takes the video off the lesson and clears its length, leaving the video row', async () => {
      await start()
      const videoId = (await lessonRow(ids.lesson)).video_id
      await supabase.from('course_lessons').update({ duration_seconds: 90 }).eq('id', ids.lesson)

      expect(await removeLessonVideo(ids.hub, ids.lesson)).toEqual({ id: ids.lesson })
      expect(await lessonRow(ids.lesson)).toEqual({ video_id: null, duration_seconds: null })
      expect((await videoRow(videoId)).id).toBe(videoId)
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.hub}/lessons/${ids.lesson}`)
    })

    it('says so when the database refuses the write, and leaves the video on the lesson', async () => {
      await start()
      const before = await lessonRow(ids.lesson)
      auth.failWrites = true
      try {
        expect(await removeLessonVideo(ids.hub, ids.lesson)).toEqual({ error: "Couldn't take the video off." })
      } finally {
        auth.failWrites = false
      }
      expect(await lessonRow(ids.lesson)).toEqual(before)
    })

    it("won't touch another course's lesson, an imported one, or work for a non-admin", async () => {
      expect(await removeLessonVideo(ids.other, ids.lesson)).toEqual({ error: expect.stringMatching(/can't be edited here/) })
      expect(await removeLessonVideo(ids.kajabi, ids.kajabiLesson)).toEqual({ error: expect.stringMatching(/can't be edited here/) })
      auth.admin = false
      expect(await removeLessonVideo(ids.hub, ids.lesson)).toEqual({ error: 'Not authorized' })
    })
  })
})
