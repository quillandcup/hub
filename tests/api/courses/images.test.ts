import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { solidImage } from '../../helpers/media-fixtures'
import { copyCourseImages } from '@/lib/courses/images'
import { courseImageSrc, courseImageUrl } from '@/lib/courses/image-urls'
import { MEDIA_BUCKET } from '@/lib/media/library'

/**
 * Course images into the media library, against the real local database and Storage with a fake source: the
 * cover, module posters and lesson thumbnails are stored once as shared library images; a re-run skips the
 * unchanged, stores a changed source again, clears an image Kajabi dropped, and sweeps leftovers.
 */

const ts = Date.now()
const COURSE = `test-images-${ts}`
const SLUG = `images-${ts}`
const url = (name: string, query = 'sig=1') => `https://kajabi.test/${name}.png?${query}`

const sources: Record<string, { status?: number; type?: string }> = {}
const calls: string[] = []
const colour = (name: string) => ({ r: [...name].reduce((n, c) => n + c.charCodeAt(0), ts) % 256, g: name.length * 31, b: (ts >> 4) % 256 })
const download = (async (input: unknown) => {
  const name = new URL(String(input)).pathname.slice(1).replace(/\.png$/, '')
  calls.push(name)
  const source = sources[name] ?? {}
  const failed = source.status && source.status >= 400
  return new Response(failed ? null : new Uint8Array(await solidImage(40, 30, 'png', colour(name))), {
    status: source.status ?? 200,
    headers: { 'content-type': source.type ?? 'image/png' },
  })
}) as typeof fetch

describe('Course images step', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const media = () => supabase.storage.from(MEDIA_BUCKET)
  const inLibrary = async (path: string) => !(await media().download(path)).error
  const lesson = async (key: string) => (await supabase.from('course_lessons').select('*').eq('source_key', `${COURSE}-${key}`).single()).data!
  const asset = async (id: string) => (await supabase.from('media_assets').select('*').eq('id', id).single()).data!

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE)
    const { data: assets } = await supabase.from('media_assets').select('id, storage_path').contains('tags', [SLUG])
    if (assets?.length) {
      await media().remove(assets.map((a) => a.storage_path))
      await supabase.from('media_assets').delete().in('id', assets.map((a) => a.id))
    }
  }

  beforeAll(async () => {
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

  it('stores the cover, the poster and the lesson thumbnails as shared library images, and records which and where from', async () => {
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result).toMatchObject({ copied: 4, alreadyCopied: 0, removed: 0, failed: [] })

    const course = (await supabase.from('courses').select('*').eq('id', ids.course).single()).data!
    expect(course.thumbnail_asset_id).toMatch(/^media_/)
    expect(course.thumbnail_source).toBe('https://kajabi.test/cover.png')
    expect(await asset(course.thumbnail_asset_id)).toMatchObject({ owner_member_id: null, source: 'kajabi', source_key: 'https://kajabi.test/cover.png', is_public: false, tags: ['kajabi', SLUG], title: `Images ${ts}`, width: 40, height: 30 })

    const a = await lesson('a')
    expect(a.thumbnail_source).toBe('https://kajabi.test/a.png')
    expect(await inLibrary((await asset(a.thumbnail_asset_id)).storage_path)).toBe(true)
    const poster = (await supabase.from('course_modules').select('*').eq('source_key', `${COURSE}-m`).single()).data!
    expect(poster.poster_asset_id).toMatch(/^media_/)
    expect((await lesson('none')).thumbnail_asset_id).toBeNull()
  })

  it('does not fetch anything again when nothing changed, even if the link got a new signature', async () => {
    calls.length = 0
    await supabase.from('course_lessons').update({ thumbnail_url: url('a', 'sig=2') }).eq('source_key', `${COURSE}-a`)
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result).toMatchObject({ copied: 0, alreadyCopied: 4, removed: 0, failed: [] })
    expect(calls).toEqual([])
  })

  it('stores the new image when the source changed, and removes the old one from the library', async () => {
    calls.length = 0
    const before = await lesson('a')
    await supabase.from('course_lessons').update({ thumbnail_url: url('a2') }).eq('source_key', `${COURSE}-a`)
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result).toMatchObject({ copied: 1, alreadyCopied: 3, failed: [] })
    expect(calls).toEqual(['a2'])
    const after = await lesson('a')
    expect(after.thumbnail_source).toBe('https://kajabi.test/a2.png')
    expect(after.thumbnail_asset_id).not.toBe(before.thumbnail_asset_id)
    expect((await asset(before.thumbnail_asset_id)).deleted_at).not.toBeNull() // nothing shows it now
  })

  it('shares one library image between two places that use the same link, fetching it once', async () => {
    calls.length = 0
    await supabase.from('course_lessons').update({ thumbnail_url: url('poster') }).eq('source_key', `${COURSE}-none`)
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result).toMatchObject({ copied: 1, failed: [] })
    expect(calls).toEqual([]) // the module's poster already put that link's image in the library
    const shared = (await lesson('none')).thumbnail_asset_id
    const poster = (await supabase.from('course_modules').select('poster_asset_id').eq('source_key', `${COURSE}-m`).single()).data!
    expect(shared).toBe(poster.poster_asset_id)
  })

  it('reports a failing or non-image source and keeps what was already stored', async () => {
    sources['c'] = { status: 404 }
    sources['d'] = { type: 'text/html' }
    await supabase.from('course_lessons').update({ thumbnail_url: url('c') }).eq('source_key', `${COURSE}-none`)
    await supabase.from('course_lessons').update({ thumbnail_url: url('d') }).eq('source_key', `${COURSE}-b`)
    const before = await lesson('b')
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result.copied).toBe(0)
    expect(result.failed.map((f) => f.error).sort()).toEqual(['not an image we can store (text/html)', 'source answered 404'])
    // b still has its earlier image, so it keeps being served from the Hub until a good source arrives.
    expect((await lesson('b')).thumbnail_asset_id).toBe(before.thumbnail_asset_id)
  })

  it('clears an image Kajabi no longer has, removes its library image, and sweeps a leftover nothing shows', async () => {
    const b = await lesson('b')
    await supabase.from('course_lessons').update({ thumbnail_url: null }).eq('id', b.id)
    await supabase.from('course_lessons').update({ thumbnail_url: null }).eq('source_key', `${COURSE}-none`)
    // A Kajabi image of this course in the library that no row shows.
    const { data: orphan } = await supabase
      .from('media_assets')
      .insert({ storage_path: `originals/shared/orphan-${ts}.png`, mime_type: 'image/png', width: 1, height: 1, bytes: 1, sha256: `orphan-${ts}`, title: 'Orphan', tags: ['kajabi', SLUG], source: 'kajabi', source_key: `https://kajabi.test/orphan-${ts}.png` })
      .select('id')
      .single()

    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result.removed).toBe(3) // b's image, the lesson that shared the poster's image, the library orphan
    const poster = (await supabase.from('course_modules').select('poster_asset_id').eq('source_key', `${COURSE}-m`).single()).data!
    expect((await asset(poster.poster_asset_id)).deleted_at).toBeNull() // the module still shows that one
    const after = await lesson('b')
    expect(after.thumbnail_asset_id).toBeNull()
    expect(after.thumbnail_source).toBeNull()
    expect((await asset(b.thumbnail_asset_id)).deleted_at).not.toBeNull()
    expect((await asset(orphan!.id)).deleted_at).not.toBeNull()
  })
})

describe('Course image URLs', () => {
  it('uses our copy when there is one (a library asset), else the Kajabi URL if it is http(s)', () => {
    expect(courseImageSrc('lesson', 'les_x', 'media_AAAAAAAAAAA1', 'https://k.test/a.png')).toBe('/api/courses/image/lesson/les_x')
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
