import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { COURSE_IMAGES_BUCKET, copyCourseImages, courseImageSrc, courseImageUrl } from '@/lib/courses/images'

/**
 * Course images into the Hub, against the real local database and Storage with a fake source: the
 * cover, module posters and lesson thumbnails are copied once into the private bucket; a re-run skips
 * the unchanged, re-copies a changed source, clears an image Kajabi dropped and sweeps orphan objects.
 */

const ts = Date.now()
const COURSE = `test-images-${ts}`
const SLUG = `images-${ts}`
const url = (name: string, query = 'sig=1') => `https://kajabi.test/${name}.png?${query}`

const sources: Record<string, { status?: number; type?: string; body?: string }> = {}
const calls: string[] = []
const download = (async (input: unknown) => {
  const name = new URL(String(input)).pathname.slice(1)
  calls.push(name)
  const source = sources[name] ?? {}
  return new Response(source.status && source.status >= 400 ? null : (source.body ?? `bytes of ${name}`), {
    status: source.status ?? 200,
    headers: { 'content-type': source.type ?? 'image/png' },
  })
}) as typeof fetch

describe('Course images step', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const bucket = () => supabase.storage.from(COURSE_IMAGES_BUCKET)
  const exists = async (path: string) => !(await bucket().download(path)).error
  const lesson = async (key: string) => (await supabase.from('course_lessons').select('*').eq('source_key', `${COURSE}-${key}`).single()).data!

  async function cleanup() {
    const { data: course } = await supabase.from('courses').select('id').eq('source_key', COURSE).maybeSingle()
    if (course) {
      for (const folder of ['', '/modules', '/lessons']) {
        const { data } = await bucket().list(`${course.id}${folder}`)
        const files = (data ?? []).filter((o) => o.id !== null).map((o) => `${course.id}${folder}/${o.name}`)
        if (files.length) await bucket().remove(files)
      }
    }
    await supabase.from('courses').delete().eq('source_key', COURSE)
  }

  beforeAll(async () => {
    await supabase.storage.createBucket(COURSE_IMAGES_BUCKET, { public: false })
    await cleanup()
    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `Images ${ts}`, source_key: COURSE, thumbnail_url: url('cover') }).select('id').single()
    ids.course = course!.id
    await supabase.from('course_modules').insert({ course_id: ids.course, title: 'M', source_key: `${COURSE}-m`, poster_url: url('poster') })
    await supabase.from('course_lessons').insert([
      { course_id: ids.course, title: 'A', position: 1, source_key: `${COURSE}-a`, thumbnail_url: url('a') },
      { course_id: ids.course, title: 'B', position: 2, source_key: `${COURSE}-b`, thumbnail_url: url('b') },
      { course_id: ids.course, title: 'None', position: 3, source_key: `${COURSE}-none` },
    ])
  })
  afterAll(cleanup)

  it('does nothing for a course that is not in the Hub yet', async () => {
    expect(await copyCourseImages(supabase, `${COURSE}-unpublished`, download)).toEqual({ copied: 0, alreadyCopied: 0, removed: 0, failed: [] })
  })

  it('copies the cover, the poster and the lesson thumbnails, and records where', async () => {
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result).toMatchObject({ copied: 4, alreadyCopied: 0, removed: 0, failed: [] })

    const course = (await supabase.from('courses').select('*').eq('id', ids.course).single()).data!
    expect(course.thumbnail_path).toBe(`${ids.course}/cover.png`)
    expect(course.thumbnail_source).toBe('https://kajabi.test/cover.png')
    const a = await lesson('a')
    expect(a.thumbnail_path).toBe(`${ids.course}/lessons/${a.id}.png`)
    expect(await exists(a.thumbnail_path)).toBe(true)
    const poster = (await supabase.from('course_modules').select('*').eq('source_key', `${COURSE}-m`).single()).data!
    expect(await exists(poster.poster_path)).toBe(true)
    expect((await lesson('none')).thumbnail_path).toBeNull()
  })

  it('does not fetch anything again when nothing changed, even if the link got a new signature', async () => {
    calls.length = 0
    await supabase.from('course_lessons').update({ thumbnail_url: url('a', 'sig=2') }).eq('source_key', `${COURSE}-a`)
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result).toMatchObject({ copied: 0, alreadyCopied: 4, removed: 0, failed: [] })
    expect(calls).toEqual([])
  })

  it('copies again when the source image changed', async () => {
    calls.length = 0
    await supabase.from('course_lessons').update({ thumbnail_url: url('a2') }).eq('source_key', `${COURSE}-a`)
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result).toMatchObject({ copied: 1, alreadyCopied: 3, failed: [] })
    expect(calls).toEqual(['a2.png'])
    expect((await lesson('a')).thumbnail_source).toBe('https://kajabi.test/a2.png')
  })

  it('reports a failing or non-image source and keeps the Kajabi URL working', async () => {
    sources['c.png'] = { status: 404 }
    sources['d.png'] = { type: 'text/html' }
    await supabase.from('course_lessons').update({ thumbnail_url: url('c') }).eq('source_key', `${COURSE}-none`)
    await supabase.from('course_lessons').update({ thumbnail_url: url('d') }).eq('source_key', `${COURSE}-b`)
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result.copied).toBe(0)
    expect(result.failed.map((f) => f.error).sort()).toEqual(['not an image we can store (text/html)', 'source answered 404'])
    // b still has its earlier copy, so it keeps being served from the Hub until a good source arrives.
    expect((await lesson('b')).thumbnail_path).not.toBeNull()
    expect((await lesson('none')).thumbnail_path).toBeNull()
  })

  it('clears an image Kajabi no longer has and sweeps objects no row points at', async () => {
    const b = await lesson('b')
    await supabase.from('course_lessons').update({ thumbnail_url: null }).eq('id', b.id)
    await supabase.from('course_lessons').update({ thumbnail_url: null }).eq('source_key', `${COURSE}-none`)
    await bucket().upload(`${ids.course}/lessons/les_gone.png`, Buffer.from('x'), { contentType: 'image/png' })

    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result.removed).toBe(2) // b's copy, and the orphan
    const after = await lesson('b')
    expect(after.thumbnail_path).toBeNull()
    expect(after.thumbnail_source).toBeNull()
    expect(await exists(b.thumbnail_path)).toBe(false)
    expect(await exists(`${ids.course}/lessons/les_gone.png`)).toBe(false)
  })
})

describe('Course image URLs', () => {
  it('uses our copy when there is one, else the Kajabi URL if it is http(s)', () => {
    expect(courseImageSrc('lesson', 'les_x', 'a/b.png', 'https://k.test/a.png')).toBe('/api/courses/image/lesson/les_x')
    expect(courseImageSrc('lesson', 'les_x', null, 'https://k.test/a.png')).toBe('https://k.test/a.png')
    expect(courseImageSrc('lesson', 'les_x', null, 'javascript:alert(1)')).toBeNull()
    expect(courseImageSrc('course', 'crs_x', null, null)).toBeNull()
  })
  it('lets our own image path through to an img tag, and nothing else relative', () => {
    expect(courseImageUrl('/api/courses/image/course/crs_x')).toBe('/api/courses/image/course/crs_x')
    expect(courseImageUrl('https://k.test/a.png')).toBe('https://k.test/a.png')
    expect(courseImageUrl('/other')).toBeNull()
    expect(courseImageUrl(undefined)).toBeNull()
  })
})
