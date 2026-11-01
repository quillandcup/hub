import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import {
  parseLessonContent,
  saveLessonContent,
  selectLessons,
  type EditorDownloads,
  type EditorPost,
} from '@/lib/kajabi/lesson-content'

/**
 * Step B (scripts/kajabi-course-content.ts) saves lesson content captured from Kajabi's admin
 * editor into Bronze. It must be safe to re-run: unchanged lessons write nothing, changed ones
 * update in place, and downloads Kajabi no longer lists are soft-deleted (and restored if they
 * come back). It never creates a lesson: Step A owns those rows.
 */
describe('Kajabi lesson content (step B) idempotency', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  const run = Date.now()
  const courseId = `test-kjc-course-${run}`
  const lessonId = `test-kjc-lesson-${run}-1`
  const draftLessonId = `test-kjc-lesson-${run}-2`
  const unknownLessonId = `test-kjc-lesson-${run}-unknown`
  const fileIds = [`test-kjc-file-${run}-a`, `test-kjc-file-${run}-b`]

  const signed = (path: string, date: string, token = 'sig') =>
    `https://bucket.example.test/${path}?X-Amz-Date=${date}&X-Amz-Expires=604800&X-Amz-Signature=${token}`
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

  function makePost(id: string, opts: { body?: string; mediaId?: string; now: Date; token?: string }): EditorPost {
    const mediaId = opts.mediaId ?? '9001'
    return {
      data: {
        id,
        attributes: { body: opts.body ?? '<p>First draft</p>', posterImageUrl: 'https://img.example.test/thumb.jpg' },
        relationships: { media: { data: { id: mediaId } } },
      },
      included: [
        {
          id: mediaId,
          type: 'video',
          attributes: {
            wistiaId: 'wist1',
            originalVideo: '/sites/1/video/a.mp4',
            status: 'ready',
            mediaLibraryAssetId: null,
            urls: { downloadUrl: signed('video.mp4', stamp(opts.now), opts.token) },
          },
        },
      ],
    }
  }

  const makeDownloads = (now: Date, ...ids: string[]): EditorDownloads => ({
    data: ids.map((id, i) => ({
      id,
      attributes: { name: `${id}.pdf`, position: i, assetUrl: signed(`${id}.pdf`, stamp(now)) },
    })),
  })

  const liveFiles = async () => {
    const { data } = await bronze.from('kajabi_lesson_files').select('kajabi_id, deleted_at, source_url').eq('lesson_kajabi_id', lessonId)
    return data ?? []
  }
  const lessonRow = async () => {
    const { data } = await bronze.from('kajabi_course_lessons').select('*').eq('kajabi_id', lessonId).single()
    return data!
  }

  async function cleanup() {
    await bronze.from('kajabi_lesson_files').delete().in('kajabi_id', fileIds)
    await bronze.from('kajabi_course_lessons').delete().in('kajabi_id', [lessonId, draftLessonId, unknownLessonId])
  }

  beforeAll(async () => {
    await cleanup()
    // What Step A leaves behind: the lesson row, no content yet.
    const { error } = await bronze.from('kajabi_course_lessons').insert([
      { kajabi_id: lessonId, course_kajabi_id: courseId, title: 'Published lesson', publishing_option: 'published' },
      { kajabi_id: draftLessonId, course_kajabi_id: courseId, title: 'Draft lesson', publishing_option: 'draft' },
    ])
    expect(error).toBeNull()
  })

  afterAll(cleanup)

  it('selects a course\'s lessons, skipping drafts unless asked', async () => {
    expect((await selectLessons(supabase, { courseId })).map((l) => l.kajabi_id)).toEqual([lessonId])
    expect((await selectLessons(supabase, { courseId }, { includeDrafts: true })).map((l) => l.kajabi_id).sort()).toEqual(
      [lessonId, draftLessonId].sort()
    )
  })

  it('saves content and files on the first run', async () => {
    const now = new Date('2026-10-19T12:00:00Z')
    const content = parseLessonContent(makePost(lessonId, { now }), makeDownloads(now, fileIds[0], fileIds[1]))

    expect(await saveLessonContent(supabase, content, now)).toBe('updated')

    const row = await lessonRow()
    expect(row.body_html).toBe('<p>First draft</p>')
    expect(row.video_media_id).toBe('9001')
    expect(row.video_source).toMatchObject({ wistia_id: 'wist1', download_url_expires_at: '2026-10-26T12:00:00.000Z' })
    expect(row.content_hash).toBe(content.contentHash)
    expect(new Date(row.content_fetched_at).toISOString()).toBe(now.toISOString())
    expect((await liveFiles()).filter((f) => f.deleted_at === null)).toHaveLength(2)
  })

  it('writes nothing when the same content is saved again (even with fresh links)', async () => {
    const before = await lessonRow()
    const later = new Date('2026-10-19T13:00:00Z')
    const content = parseLessonContent(makePost(lessonId, { now: later, token: 'other' }), makeDownloads(later, fileIds[0], fileIds[1]))

    expect(await saveLessonContent(supabase, content, later)).toBe('unchanged')

    const after = await lessonRow()
    expect(after.content_fetched_at).toBe(before.content_fetched_at)
    expect(after.video_source).toEqual(before.video_source)
    expect((await liveFiles()).filter((f) => f.deleted_at === null)).toHaveLength(2)
  })

  it('updates in place when the lesson changes, without duplicating files', async () => {
    const now = new Date('2026-10-19T14:00:00Z')
    const content = parseLessonContent(makePost(lessonId, { now, body: '<p>Edited</p>' }), makeDownloads(now, fileIds[0], fileIds[1]))

    expect(await saveLessonContent(supabase, content, now)).toBe('updated')

    expect((await lessonRow()).body_html).toBe('<p>Edited</p>')
    expect(await liveFiles()).toHaveLength(2)
  })

  it('treats a replaced video (new media id) as a change', async () => {
    const now = new Date('2026-10-19T15:00:00Z')
    const content = parseLessonContent(makePost(lessonId, { now, body: '<p>Edited</p>', mediaId: '9002' }), makeDownloads(now, fileIds[0], fileIds[1]))

    expect(await saveLessonContent(supabase, content, now)).toBe('updated')
    expect((await lessonRow()).video_media_id).toBe('9002')
  })

  it('soft-deletes a download Kajabi no longer lists, and restores it when it returns', async () => {
    const now = new Date('2026-10-19T16:00:00Z')
    const without = parseLessonContent(makePost(lessonId, { now, body: '<p>No file b</p>', mediaId: '9002' }), makeDownloads(now, fileIds[0]))
    expect(await saveLessonContent(supabase, without, now)).toBe('updated')

    let files = await liveFiles()
    expect(files).toHaveLength(2)
    expect(files.find((f) => f.kajabi_id === fileIds[1])!.deleted_at).not.toBeNull()
    expect(files.find((f) => f.kajabi_id === fileIds[0])!.deleted_at).toBeNull()

    const back = new Date('2026-10-19T17:00:00Z')
    const restored = parseLessonContent(makePost(lessonId, { now: back, body: '<p>File b back</p>', mediaId: '9002' }), makeDownloads(back, fileIds[0], fileIds[1]))
    expect(await saveLessonContent(supabase, restored, back)).toBe('updated')

    files = await liveFiles()
    expect(files).toHaveLength(2)
    expect(files.every((f) => f.deleted_at === null)).toBe(true)
  })

  it('refreshes the stored links when they are about to expire, changing nothing else', async () => {
    const stale = new Date('2026-10-19T17:00:00Z') // its links expire 2026-10-26T17:00Z
    const nearExpiry = new Date('2026-10-26T10:00:00Z')
    const before = await lessonRow()
    const content = parseLessonContent(
      makePost(lessonId, { now: nearExpiry, body: '<p>File b back</p>', mediaId: '9002', token: 'fresh' }),
      makeDownloads(nearExpiry, fileIds[0], fileIds[1])
    )
    expect(stale.getTime()).toBeLessThan(nearExpiry.getTime())

    expect(await saveLessonContent(supabase, content, nearExpiry)).toBe('urls_refreshed')

    const after = await lessonRow()
    expect(after.content_fetched_at).toBe(before.content_fetched_at)
    expect(after.video_source.download_url_expires_at).toBe('2026-11-02T10:00:00.000Z')
    expect((await liveFiles())[0].source_url).toContain(stamp(nearExpiry))
  })

  it('reports a dry run without writing', async () => {
    const now = new Date('2026-10-19T18:00:00Z')
    const before = await lessonRow()
    const content = parseLessonContent(makePost(lessonId, { now, body: '<p>Dry run edit</p>', mediaId: '9002' }), makeDownloads(now, fileIds[0], fileIds[1]))

    expect(await saveLessonContent(supabase, content, now, { dryRun: true })).toBe('updated')
    expect((await lessonRow()).body_html).toBe(before.body_html)
  })

  it('does not create a lesson Step A has not imported', async () => {
    const now = new Date('2026-10-19T12:00:00Z')
    const content = parseLessonContent(makePost(unknownLessonId, { now }), makeDownloads(now))

    expect(await saveLessonContent(supabase, content, now)).toBe('missing')

    const { data } = await bronze.from('kajabi_course_lessons').select('kajabi_id').eq('kajabi_id', unknownLessonId)
    expect(data).toEqual([])
  })
})
