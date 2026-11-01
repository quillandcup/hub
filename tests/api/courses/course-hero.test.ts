import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { saveCourseHero } from '@/lib/kajabi/course-hero'
import { processCourses } from '@/lib/courses/process'
import { copyCourseImages } from '@/lib/courses/images'
import { MEDIA_BUCKET } from '@/lib/media/library'
import { solidImage } from '../../helpers/media-fixtures'

/**
 * A course's hero banner, end to end against the real local database and Storage with a fake source:
 * recorded on the Bronze course (never cleared, never overwritten by a re-import), copied to Silver by
 * processing, then into the media library once, again when it changes, and removed when it goes.
 */

const ts = Date.now()
const COURSE = `test-hero-${ts}`
const TITLE = `Hero ${ts}`
const SLUG = `hero-${ts}`
const NOW = new Date('2026-10-27T12:00:00Z')

const calls: string[] = []
const download = (async (input: unknown) => {
  const name = new URL(String(input)).pathname.slice(1)
  calls.push(name)
  const seed = [...name].reduce((n, c) => n + c.charCodeAt(0), 0)
  return new Response(new Uint8Array(await solidImage(40, 30, 'jpeg', { r: seed % 256, g: (seed * 7) % 256, b: Date.now() % 256 })), { status: 200, headers: { 'content-type': 'image/jpeg' } })
}) as typeof fetch

describe('Course hero image', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = () => supabase.schema('bronze').from('kajabi_courses')
  const silver = async () => (await supabase.from('courses').select('*').eq('source_key', COURSE).single()).data!
  const bronzeRow = async () => (await bronze().select('*').eq('kajabi_id', COURSE).single()).data!

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE)
    await bronze().delete().eq('kajabi_id', COURSE)
    const { data: assets } = await supabase.from('media_assets').select('id, storage_path').contains('tags', [SLUG])
    if (assets?.length) {
      await supabase.storage.from(MEDIA_BUCKET).remove(assets.map((a) => a.storage_path))
      await supabase.from('media_assets').delete().in('id', assets.map((a) => a.id))
    }
  }

  beforeAll(async () => {
    await cleanup()
    await bronze().insert({ kajabi_id: COURSE, title: TITLE, raw_payload: { attributes: { description: 'd', thumbnail_url: 'https://kajabi.test/thumb.png' } } })
  })
  afterAll(cleanup)

  it('says missing for a course Step A has not imported, and writes nothing', async () => {
    expect(await saveCourseHero(supabase, `${COURSE}-nope`, 'https://kajabi.test/h.jpg', NOW)).toBe('missing')
  })

  it('records the hero on the Bronze course; a dry run, and the same URL again, write nothing', async () => {
    expect(await saveCourseHero(supabase, COURSE, 'https://kajabi.test/h1.jpg', NOW, { dryRun: true })).toBe('updated')
    expect((await bronzeRow()).hero_image_url).toBeNull()

    expect(await saveCourseHero(supabase, COURSE, 'https://kajabi.test/h1.jpg', NOW)).toBe('updated')
    const row = await bronzeRow()
    expect(row.hero_image_url).toBe('https://kajabi.test/h1.jpg')
    expect(new Date(row.hero_captured_at!).getTime()).toBe(NOW.getTime())

    expect(await saveCourseHero(supabase, COURSE, 'https://kajabi.test/h1.jpg', new Date('2027-01-01T00:00:00Z'))).toBe('unchanged')
    expect(new Date((await bronzeRow()).hero_captured_at!).getTime()).toBe(NOW.getTime())
  })

  it('processing carries the hero to the published course, and leaves the cover alone', async () => {
    await processCourses(supabase, { courseSlug: SLUG, accessDuration: '1 year' })
    const course = await silver()
    expect(course.hero_url).toBe('https://kajabi.test/h1.jpg')
    expect(course.thumbnail_url).toBe('https://kajabi.test/thumb.png')
  })

  it('copies the hero into the media library once, records which image, and does not fetch it again', async () => {
    const first = await copyCourseImages(supabase, COURSE, download)
    expect(first).toMatchObject({ copied: 2, failed: [] }) // the cover and the hero
    const course = await silver()
    expect(course.hero_asset_id).toMatch(/^media_/)
    expect(course.hero_source).toBe('https://kajabi.test/h1.jpg')
    expect(course.thumbnail_asset_id).toMatch(/^media_/)
    const hero = (await supabase.from('media_assets').select('storage_path, source_key').eq('id', course.hero_asset_id).single()).data!
    expect(hero.source_key).toBe('https://kajabi.test/h1.jpg')
    expect((await supabase.storage.from(MEDIA_BUCKET).download(hero.storage_path)).error).toBeNull()

    calls.length = 0
    const again = await copyCourseImages(supabase, COURSE, download)
    expect(again).toMatchObject({ copied: 0, alreadyCopied: 2, removed: 0 })
    expect(calls).toEqual([])
  })

  it('a re-import of the course (Step A) does not wipe the hero', async () => {
    await bronze().upsert({ kajabi_id: COURSE, title: TITLE, raw_payload: { attributes: { description: 'd2' } }, fetched_at: NOW.toISOString(), deleted_at: null }, { onConflict: 'kajabi_id' })
    expect((await bronzeRow()).hero_image_url).toBe('https://kajabi.test/h1.jpg')
  })

  it('copies again when the hero changes, and removes our copy when Kajabi no longer has one', async () => {
    await saveCourseHero(supabase, COURSE, 'https://kajabi.test/h2.jpg', NOW)
    await processCourses(supabase, { courseSlug: SLUG })
    calls.length = 0
    expect(await copyCourseImages(supabase, COURSE, download)).toMatchObject({ copied: 1, failed: [] })
    expect(calls).toEqual(['h2.jpg'])
    const changed = await silver()
    expect(changed.hero_source).toBe('https://kajabi.test/h2.jpg')

    await bronze().update({ hero_image_url: null }).eq('kajabi_id', COURSE)
    await processCourses(supabase, { courseSlug: SLUG })
    const result = await copyCourseImages(supabase, COURSE, download)
    expect(result.removed).toBe(1)
    const cleared = await silver()
    expect(cleared.hero_asset_id).toBeNull()
    expect(cleared.hero_source).toBeNull()
    expect((await supabase.from('media_assets').select('deleted_at').eq('id', changed.hero_asset_id!).single()).data!.deleted_at).not.toBeNull()
  })
})
