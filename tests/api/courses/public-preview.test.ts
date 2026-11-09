import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { publicLessonPreview } from '@/lib/courses/public-preview'
import { createRepos } from "@/lib/data/repos";

/**
 * What anyone may see of a lesson without signing in (a shared link's title, picture and teaser):
 * only a lesson a member could open today, in a live course.
 */

const ts = Date.now()
const SLUG = `test-public-preview-${ts}`

describe('Public lesson preview', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const now = new Date()
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString()

  const preview = (name: string, opts: { slug?: string; now?: Date } = {}) => publicLessonPreview(createRepos(supabase), ids[name] ?? name, opts)

  beforeAll(async () => {
    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: 'The Ready Writer', source_key: SLUG }).select('id').single()
    ids.course = course!.id
    const { data: modules } = await supabase
      .from('course_modules')
      .insert([
        { course_id: ids.course, title: 'Open module', position: 1, state: 'open', source_key: `${SLUG}-m1` },
        { course_id: ids.course, title: 'Locked module', position: 2, state: 'coming_soon', source_key: `${SLUG}-m2` },
      ])
      .select('id, title')
    const open = modules!.find((m) => m.title === 'Open module')!.id
    const locked = modules!.find((m) => m.title === 'Locked module')!.id
    const { data: week } = await supabase.from('course_modules').insert({ course_id: ids.course, parent_id: locked, title: 'Open week in locked module', position: 1, state: 'open', source_key: `${SLUG}-w1` }).select('id').single()
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, title: 'Loose', position: 1, state: 'open', source_key: `${SLUG}-l1`, excerpt: 'Hey Hedgies, today we talk about expectations.', thumbnail_url: 'https://example.com/loose.jpg' },
        { course_id: ids.course, module_id: open, title: 'In open module', position: 1, state: 'open', source_key: `${SLUG}-l2` },
        { course_id: ids.course, module_id: locked, title: 'In locked module', position: 1, state: 'open', source_key: `${SLUG}-l3` },
        { course_id: ids.course, module_id: week!.id, title: 'In week in locked module', position: 1, state: 'open', source_key: `${SLUG}-l4` },
        { course_id: ids.course, title: 'Coming soon', position: 2, state: 'coming_soon', source_key: `${SLUG}-l5` },
        { course_id: ids.course, title: 'Draft', position: 3, state: 'hidden', source_key: `${SLUG}-l6` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[l.title.toLowerCase().replace(/ /g, '_')] = l.id
  })
  afterAll(async () => {
    await supabase.from('courses').delete().eq('source_key', SLUG) // modules and lessons go with it
  })

  it("gives an open lesson's title, its course, its excerpt and its thumbnail", async () => {
    const result = await preview('loose', { slug: SLUG })
    expect(result).toEqual({
      preview: { lessonId: ids.loose, title: 'Loose', excerpt: 'Hey Hedgies, today we talk about expectations.', courseSlug: SLUG, courseTitle: 'The Ready Writer', thumbnailSrc: 'https://example.com/loose.jpg', thumbnailSize: null },
    })
  })

  it('has no excerpt or thumbnail when the lesson has none, and never gives anything else of the lesson', async () => {
    const result = await preview('in_open_module')
    expect(result).toMatchObject({ preview: { excerpt: null, thumbnailSrc: null } })
    expect(Object.keys((result as { preview: object }).preview).sort()).toEqual(['courseSlug', 'courseTitle', 'excerpt', 'lessonId', 'thumbnailSize', 'thumbnailSrc', 'title'])
  })

  it("declares the pixel size of a thumbnail that is a library copy, so a link preview can show it large", async () => {
    const { data: asset, error } = await supabase
      .from('media_assets')
      .insert({ storage_path: `originals/shared/${SLUG}.png`, mime_type: 'image/png', width: 1280, height: 720, bytes: 1, sha256: SLUG, title: SLUG, source: 'kajabi', source_key: `https://kajabi.test/${SLUG}.png` })
      .select('id')
      .single()
    expect(error).toBeNull()
    try {
      await supabase.from('course_lessons').update({ thumbnail_asset_id: asset!.id }).eq('id', ids.in_open_module)
      expect(await preview('in_open_module')).toMatchObject({
        preview: { thumbnailSrc: `/api/courses/image/lesson/${ids.in_open_module}`, thumbnailSize: { width: 1280, height: 720 } },
      })
    } finally {
      await supabase.from('course_lessons').update({ thumbnail_asset_id: null }).eq('id', ids.in_open_module)
      await supabase.from('media_assets').delete().eq('id', asset!.id)
    }
  })

  it('is open for a lesson inside an open module', async () => {
    expect(await preview('in_open_module')).toHaveProperty('preview')
  })

  it("is blocked for a coming-soon lesson, a draft, and a lesson in a locked module or in a week below one", async () => {
    for (const name of ['coming_soon', 'draft', 'in_locked_module', 'in_week_in_locked_module']) expect(await preview(name), name).toEqual({ blocked: 'not_open' })
  })

  it('is blocked for an unknown lesson, and for a lesson under another course address', async () => {
    expect(await preview('les_AAAAAAAAAAA1')).toEqual({ blocked: 'not_found' })
    expect(await preview('loose', { slug: 'some-other-course' })).toEqual({ blocked: 'not_found' })
  })

  it("is blocked until the course opens, then public from its opening date", async () => {
    await supabase.from('courses').update({ launch_at: days(10) }).eq('id', ids.course)
    expect(await preview('loose')).toEqual({ blocked: 'course_not_live' })
    expect(await preview('loose', { now: new Date(now.getTime() + 11 * 86_400_000) })).toHaveProperty('preview')
    await supabase.from('courses').update({ launch_at: null }).eq('id', ids.course)
    expect(await preview('loose')).toHaveProperty('preview')
  })

  it('is blocked while the course is a draft, and public once it is published', async () => {
    await supabase.from('courses').update({ is_draft: true }).eq('id', ids.course)
    expect(await preview('loose')).toEqual({ blocked: 'course_not_live' })
    await supabase.from('courses').update({ is_draft: false }).eq('id', ids.course)
    expect(await preview('loose')).toHaveProperty('preview')
  })
})
