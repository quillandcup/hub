import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { COURSE_FILES_BUCKET } from '@/lib/courses/file-format'

/**
 * Captions on a Hub-owned lesson's video, against the real database and the real `course-files` bucket. Who is calling and
 * Mux are faked: what is tested is who may do it, what is kept (the file in the bucket, the track's row), what Mux is
 * asked for, and what is cleaned up when a step fails.
 */

const ts = Date.now()
const PREFIX = `test-lcap-${ts}`
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello Hedgies\n'
const SRT = '1\n00:00:01,000 --> 00:00:03,500\nHello Hedgies\n'

const auth = vi.hoisted(() => ({ admin: true }))
vi.mock('@/lib/admin-auth', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return {
    requireAdminAction: async () => (auth.admin ? { ok: true, user: { id: 'user-admin', email: 'admin@example.test' }, supabase: getTestSupabaseAdminClient() } : { ok: false, error: 'Not authorized' }),
  }
})
vi.mock('@/lib/analytics/server', () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))
const mux = vi.hoisted(() => ({ addTextTrack: vi.fn(), removeTextTrack: vi.fn(), generateTextTrack: vi.fn() }))
vi.mock('@/lib/mux', () => ({ createMuxClient: () => ({}), ...mux }))

// The service client the actions use, unable to write the tracks table when asked: a failed step after Mux or storage has done its part.
const fault = vi.hoisted(() => ({ rows: false }))
vi.mock('@/lib/supabase/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/service')>('@/lib/supabase/service')
  return {
    createServiceRoleClient: () => {
      const client = actual.createServiceRoleClient()
      if (!fault.rows) return client
      return new Proxy(client, {
        get: (target, prop) =>
          prop === 'from'
            ? (table: string) => (table === 'video_text_tracks' ? { select: (...a: unknown[]) => (target.from(table) as any).select(...a), insert: () => { throw new Error('connection lost') }, delete: () => { throw new Error('connection lost') } } : target.from(table as 'courses'))
            : (target as any)[prop],
      })
    },
  }
})

import { addLessonCaptions, generateLessonCaptions, removeLessonCaptions } from '@/app/(admin)/admin/courses/lesson-caption-actions'

describe('Lesson caption actions', () => {
  const supabase = getTestSupabaseAdminClient()
  const bucket = () => supabase.storage.from(COURSE_FILES_BUCKET)
  const ids: Record<string, string> = {}
  const notEditable = { error: expect.stringMatching(/can't be edited here/) }
  const tracks = async () => (await supabase.from('video_text_tracks').select('*').eq('video_id', ids.video).order('created_at')).data ?? []
  const stored = async (path: string) => ((await bucket().list(path.split('/').slice(0, -1).join('/'))).data ?? []).some((o) => path.endsWith(`/${o.name}`))
  const add = (over: Partial<{ language: string; label: string; text: string }> = {}) => addLessonCaptions(ids.hub, ids.lesson, { language: 'en', label: '', text: VTT, ...over })

  beforeAll(async () => {
    await supabase.storage.createBucket(COURSE_FILES_BUCKET, { public: false })
    const insertCourse = async (slug: string, source: string) => (await supabase.from('courses').insert({ slug: `${PREFIX}-${slug}`, title: slug, source, ...(source === 'kajabi' ? { source_key: `${PREFIX}-${slug}` } : {}) }).select('id').single()).data!.id
    ids.hub = await insertCourse('hub', 'hub')
    ids.other = await insertCourse('other', 'hub')
    ids.kajabi = await insertCourse('kajabi', 'kajabi')
    ids.video = (await supabase.from('videos').insert({ source_kind: 'upload', source_key: `${PREFIX}-video`, status: 'ready', mux_playback_id: 'pb', mux_asset_id: `${PREFIX}-asset` }).select('id').single()).data!.id
    ids.lesson = (await supabase.from('course_lessons').insert({ course_id: ids.hub, title: 'Lesson', position: 1, publishing_option: 'draft', source: 'hub', video_id: ids.video }).select('id').single()).data!.id
    ids.kajabiLesson = (await supabase.from('course_lessons').insert({ course_id: ids.kajabi, title: 'Imported', position: 1, publishing_option: 'published', state: 'open', source: 'kajabi', source_key: `${PREFIX}-l` }).select('id').single()).data!.id
  })
  beforeEach(async () => {
    auth.admin = true
    fault.rows = false
    vi.clearAllMocks()
    mux.addTextTrack.mockResolvedValue({ trackId: 'trk-manual' })
    mux.removeTextTrack.mockResolvedValue(undefined)
    mux.generateTextTrack.mockResolvedValue({ trackId: 'trk-auto' })
    // Each test starts with a video that has no tracks and is ready.
    for (const t of await tracks()) if (t.storage_path) await bucket().remove([t.storage_path])
    await supabase.from('video_text_tracks').delete().eq('video_id', ids.video)
    await supabase.from('videos').update({ status: 'ready' }).eq('id', ids.video)
    await supabase.from('course_lessons').update({ video_id: ids.video }).eq('id', ids.lesson)
  })
  afterAll(async () => {
    for (const t of await tracks()) if (t.storage_path) await bucket().remove([t.storage_path])
    await supabase.from('courses').delete().like('slug', `${PREFIX}%`)
    await supabase.from('videos').delete().like('source_key', `${PREFIX}%`)
  })

  describe('addLessonCaptions', () => {
    it('keeps the file, attaches it to the Mux asset from a short-lived link, records the track, and refreshes the pages', async () => {
      expect(await add({ language: 'es', label: 'Español' })).toEqual({ id: ids.lesson })

      const [track] = await tracks()
      expect(track).toMatchObject({ kind: 'captions', language: 'es', label: 'Español', source: 'manual', mux_track_id: 'trk-manual' })
      expect(track.storage_path).toMatch(new RegExp(`^video-tracks/${ids.video}/[0-9a-f-]{36}\\.vtt$`))
      expect(await stored(track.storage_path!)).toBe(true)
      expect((await bucket().download(track.storage_path!)).data).toBeTruthy()

      expect(mux.addTextTrack).toHaveBeenCalledWith(expect.anything(), `${PREFIX}-asset`, { url: expect.stringContaining(track.storage_path!.split('/').pop()!), language: 'es', name: 'Español', closedCaptions: true })
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.hub}/lessons/${ids.lesson}`)
    })

    it('names the track after the language when it has no name, and keeps a SubRip file as it is', async () => {
      await add({ language: 'fr', text: SRT })
      const [track] = await tracks()
      expect(track).toMatchObject({ label: 'French', language: 'fr' })
      expect(track.storage_path).toMatch(/\.srt$/)
    })

    it('refuses a name another track already has, whatever its case, and asks Mux for nothing', async () => {
      await add({ label: 'English' })
      mux.addTextTrack.mockClear()
      expect(await add({ label: 'english' })).toEqual({ error: 'There is already a track called “english”. Remove it first, or use another name.' })
      expect(mux.addTextTrack).not.toHaveBeenCalled()
      expect(await tracks()).toHaveLength(1)
    })

    it('replaces the automatic track in the same language, and leaves the others', async () => {
      await supabase.from('video_text_tracks').insert([
        { video_id: ids.video, kind: 'subtitles', language: 'en', label: 'English (automatic)', source: 'mux_auto', mux_track_id: 'trk-auto-en' },
        { video_id: ids.video, kind: 'subtitles', language: 'de', label: 'German (automatic)', source: 'mux_auto', mux_track_id: 'trk-auto-de' },
      ])
      expect(await add()).toEqual({ id: ids.lesson })

      expect((await tracks()).map((t) => t.label).sort()).toEqual(['English', 'German (automatic)'])
      expect(mux.removeTextTrack).toHaveBeenCalledWith(expect.anything(), `${PREFIX}-asset`, 'trk-auto-en')
      expect(mux.removeTextTrack).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'trk-auto-de')
    })

    it('says so when Mux refuses, and keeps nothing', async () => {
      mux.addTextTrack.mockRejectedValue(new Error('mux down'))
      expect(await add()).toEqual({ error: "Couldn't add the captions." })
      expect(await tracks()).toEqual([])
      const listed = (await bucket().list(`video-tracks/${ids.video}`)).data ?? []
      expect(listed).toEqual([])
    })

    it('takes the track off Mux and out of the bucket when it cannot be recorded', async () => {
      fault.rows = true
      expect(await add()).toEqual({ error: "Couldn't add the captions." })
      fault.rows = false
      expect(mux.removeTextTrack).toHaveBeenCalledWith(expect.anything(), `${PREFIX}-asset`, 'trk-manual')
      expect(await tracks()).toEqual([])
      expect((await bucket().list(`video-tracks/${ids.video}`)).data ?? []).toEqual([])
    })

    it('refuses a language that is not offered, a file that is not captions, an empty or too large one, before touching anything', async () => {
      expect(await add({ language: 'xx' })).toEqual({ error: 'Choose a language.' })
      expect(await add({ text: 'Hello there' })).toEqual({ error: expect.stringMatching(/doesn't look like a caption file/) })
      expect(await add({ text: ' ' })).toEqual({ error: 'That file is empty.' })
      expect(await add({ text: `${VTT}${'x'.repeat(800_001)}` })).toEqual({ error: 'That file is too large for captions.' })
      expect(mux.addTextTrack).not.toHaveBeenCalled()
      expect(await tracks()).toEqual([])
    })

    it("needs a video that is ready: none on the lesson, or still being prepared", async () => {
      await supabase.from('videos').update({ status: 'preparing' }).eq('id', ids.video)
      expect(await add()).toEqual({ error: "The video isn't ready yet." })
      await supabase.from('course_lessons').update({ video_id: null }).eq('id', ids.lesson)
      expect(await add()).toEqual({ error: 'This lesson has no video.' })
    })

    it("won't add to another course's lesson, an imported one, a bad id, or for a non-admin", async () => {
      expect(await addLessonCaptions(ids.other, ids.lesson, { language: 'en', label: '', text: VTT })).toEqual(notEditable)
      expect(await addLessonCaptions(ids.kajabi, ids.kajabiLesson, { language: 'en', label: '', text: VTT })).toEqual(notEditable)
      expect(await addLessonCaptions('nope', ids.lesson, { language: 'en', label: '', text: VTT })).toEqual(notEditable)
      auth.admin = false
      expect(await add()).toEqual({ error: 'Not authorized' })
      expect(mux.addTextTrack).not.toHaveBeenCalled()
    })
  })

  describe('generateLessonCaptions', () => {
    it('has Mux write subtitles from the audio and records the track as automatic', async () => {
      expect(await generateLessonCaptions(ids.hub, ids.lesson, 'en')).toEqual({ id: ids.lesson })

      expect(mux.generateTextTrack).toHaveBeenCalledWith(expect.anything(), `${PREFIX}-asset`, { language: 'en', name: 'English (automatic)' })
      expect(await tracks()).toEqual([expect.objectContaining({ kind: 'subtitles', language: 'en', label: 'English (automatic)', source: 'mux_auto', mux_track_id: 'trk-auto', storage_path: null })])
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.hub}/lessons/${ids.lesson}`)
    })

    it('refuses a language that already has captions, whatever made them, and one that is not offered', async () => {
      await add()
      expect(await generateLessonCaptions(ids.hub, ids.lesson, 'en')).toEqual({ error: 'English already has captions. Remove them first to make new ones.' })
      expect(await generateLessonCaptions(ids.hub, ids.lesson, 'xx')).toEqual({ error: 'Choose a language.' })
      expect(mux.generateTextTrack).not.toHaveBeenCalled()
    })

    it('says so when Mux cannot, and records nothing', async () => {
      mux.generateTextTrack.mockRejectedValue(new Error('no audio'))
      expect(await generateLessonCaptions(ids.hub, ids.lesson, 'en')).toEqual({ error: "Couldn't make the captions." })
      expect(await tracks()).toEqual([])
    })

    it('takes the track off Mux again when it cannot be recorded', async () => {
      fault.rows = true
      expect(await generateLessonCaptions(ids.hub, ids.lesson, 'en')).toEqual({ error: "Couldn't make the captions." })
      fault.rows = false
      expect(mux.removeTextTrack).toHaveBeenCalledWith(expect.anything(), `${PREFIX}-asset`, 'trk-auto')
    })

    it("needs a ready video, and won't work for another course's lesson, an imported one or a non-admin", async () => {
      expect(await generateLessonCaptions(ids.other, ids.lesson, 'en')).toEqual(notEditable)
      expect(await generateLessonCaptions(ids.kajabi, ids.kajabiLesson, 'en')).toEqual(notEditable)
      await supabase.from('videos').update({ status: 'preparing' }).eq('id', ids.video)
      expect(await generateLessonCaptions(ids.hub, ids.lesson, 'en')).toEqual({ error: "The video isn't ready yet." })
      auth.admin = false
      expect(await generateLessonCaptions(ids.hub, ids.lesson, 'en')).toEqual({ error: 'Not authorized' })
    })
  })

  describe('removeLessonCaptions', () => {
    it('takes the track off Mux, out of the bucket and out of the table', async () => {
      await add()
      const [track] = await tracks()

      expect(await removeLessonCaptions(ids.hub, ids.lesson, track.id)).toEqual({ id: track.id })
      expect(mux.removeTextTrack).toHaveBeenCalledWith(expect.anything(), `${PREFIX}-asset`, 'trk-manual')
      expect(await tracks()).toEqual([])
      expect(await stored(track.storage_path!)).toBe(false)
    })

    it('removes an automatic track, which has no file of ours', async () => {
      await generateLessonCaptions(ids.hub, ids.lesson, 'en')
      const [track] = await tracks()
      expect(await removeLessonCaptions(ids.hub, ids.lesson, track.id)).toEqual({ id: track.id })
      expect(await tracks()).toEqual([])
    })

    it('still removes the track from the lesson when Mux cannot be reached', async () => {
      await add()
      const [track] = await tracks()
      mux.removeTextTrack.mockRejectedValue(new Error('mux down'))
      expect(await removeLessonCaptions(ids.hub, ids.lesson, track.id)).toEqual({ id: track.id })
      expect(await tracks()).toEqual([])
    })

    it('says so when the track cannot be removed from the table', async () => {
      await generateLessonCaptions(ids.hub, ids.lesson, 'en')
      const [track] = await tracks()
      fault.rows = true
      expect(await removeLessonCaptions(ids.hub, ids.lesson, track.id)).toEqual({ error: "Couldn't remove the captions." })
      fault.rows = false
      expect(await tracks()).toHaveLength(1)
    })

    it("says so for a track that isn't this video's or isn't an id, and won't work for another course, an imported lesson or a non-admin", async () => {
      await add()
      const [track] = await tracks()
      const otherVideo = (await supabase.from('videos').insert({ source_kind: 'upload', source_key: `${PREFIX}-other-video`, status: 'ready' }).select('id').single()).data!.id
      const foreign = (await supabase.from('video_text_tracks').insert({ video_id: otherVideo, kind: 'captions', language: 'en', label: 'Foreign', source: 'manual' }).select('id').single()).data!.id

      expect(await removeLessonCaptions(ids.hub, ids.lesson, foreign)).toEqual({ error: 'Not found.' })
      expect(await removeLessonCaptions(ids.hub, ids.lesson, 'nope')).toEqual({ error: 'Not found.' })
      expect(await removeLessonCaptions(ids.other, ids.lesson, track.id)).toEqual(notEditable)
      expect(await removeLessonCaptions(ids.kajabi, ids.kajabiLesson, track.id)).toEqual(notEditable)
      auth.admin = false
      expect(await removeLessonCaptions(ids.hub, ids.lesson, track.id)).toEqual({ error: 'Not authorized' })
      expect(await tracks()).toHaveLength(1)
    })
  })
})
