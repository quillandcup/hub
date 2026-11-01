import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { publicLessonPreview } from '@/lib/courses/public-preview'
import { isFeatureOnForEveryone } from '@/lib/features.server'

/**
 * What anyone may see of a lesson without signing in (a shared link's title, picture and teaser):
 * only a lesson a member could open today, in a live course, with the courses feature on for everyone.
 */

const ts = Date.now()
const SLUG = `test-public-preview-${ts}`

describe('Public lesson preview', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  let priorFlag: { feature_key: string; enabled_globally: boolean } | null = null
  const now = new Date()
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString()

  const setFlag = async (on: boolean) => {
    const { error } = await supabase.from('feature_flags').upsert({ feature_key: 'courses', enabled_globally: on })
    expect(error).toBeNull()
  }
  const preview = (name: string, opts: { slug?: string; now?: Date } = {}) => publicLessonPreview(supabase, ids[name] ?? name, opts)

  beforeAll(async () => {
    const { data } = await supabase.from('feature_flags').select('feature_key, enabled_globally').eq('feature_key', 'courses').maybeSingle()
    priorFlag = data
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
    await setFlag(true)
  })
  afterAll(async () => {
    await supabase.from('courses').delete().eq('source_key', SLUG) // modules and lessons go with it
    if (priorFlag) await supabase.from('feature_flags').upsert(priorFlag)
    else await supabase.from('feature_flags').delete().eq('feature_key', 'courses')
  })

  it("gives an open lesson's title, its course, its excerpt and its thumbnail", async () => {
    const result = await preview('loose', { slug: SLUG })
    expect(result).toEqual({
      preview: { lessonId: ids.loose, title: 'Loose', excerpt: 'Hey Hedgies, today we talk about expectations.', courseSlug: SLUG, courseTitle: 'The Ready Writer', thumbnailSrc: 'https://example.com/loose.jpg' },
    })
  })

  it('has no excerpt or thumbnail when the lesson has none, and never gives anything else of the lesson', async () => {
    const result = await preview('in_open_module')
    expect(result).toMatchObject({ preview: { excerpt: null, thumbnailSrc: null } })
    expect(Object.keys((result as { preview: object }).preview).sort()).toEqual(['courseSlug', 'courseTitle', 'excerpt', 'lessonId', 'thumbnailSrc', 'title'])
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

  it('is blocked whenever the courses feature is not on for everyone, even if a segment or a member has it', async () => {
    await setFlag(false)
    expect(await isFeatureOnForEveryone(supabase, 'courses')).toBe(false)
    expect(await preview('loose')).toEqual({ blocked: 'feature_off' })
    await supabase.from('feature_flags').delete().eq('feature_key', 'courses')
    expect(await isFeatureOnForEveryone(supabase, 'courses')).toBe(false)
    expect(await preview('loose')).toEqual({ blocked: 'feature_off' })
    await setFlag(true)
    expect(await isFeatureOnForEveryone(supabase, 'courses')).toBe(true)
  })
})
