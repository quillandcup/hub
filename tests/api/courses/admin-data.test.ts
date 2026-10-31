import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { loadAdminCourse, loadAdminCourseTitle, loadAdminLesson, loadAdminCourses, loadHubCourse } from '@/lib/courses/admin'
import { accessLabel } from '@/lib/courses/access-options'

/**
 * What the admin Courses page reads, against the real local database: each Kajabi course with its
 * Hub state, access counts and lesson states, and one course's lessons explained (including the
 * real-world case of published weeks inside a locked module).
 */

const ts = Date.now()
const PUBLISHED = `test-adm-pub-${ts}`
const UNPUBLISHED = `test-adm-unpub-${ts}`

describe('Admin course data', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  const ids: Record<string, string> = {}
  const now = new Date()
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString()

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', PUBLISHED)
    await bronze.from('kajabi_lesson_files').delete().like('kajabi_id', `${PUBLISHED}-%`)
    for (const id of [PUBLISHED, UNPUBLISHED]) {
      await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', id)
      await bronze.from('kajabi_course_modules').delete().eq('course_kajabi_id', id)
      await bronze.from('kajabi_courses').delete().eq('kajabi_id', id)
    }
    await supabase.from('members').delete().like('email', `adm-%-${ts}@example.com`)
  }

  beforeAll(async () => {
    await cleanup()
    await bronze.from('kajabi_courses').insert([
      { kajabi_id: PUBLISHED, title: `Admin Published ${ts}`, raw_payload: {} },
      { kajabi_id: UNPUBLISHED, title: `Admin Unpublished ${ts}`, raw_payload: {} },
    ])
    await bronze.from('kajabi_course_modules').insert([
      { kajabi_id: `${PUBLISHED}-m2`, course_kajabi_id: PUBLISHED, position: 2, title: 'Module 2', publishing_option: 'locked' },
      { kajabi_id: `${PUBLISHED}-w1`, course_kajabi_id: PUBLISHED, parent_kajabi_id: `${PUBLISHED}-m2`, position: 1, title: 'Week 1', publishing_option: 'published' },
      { kajabi_id: `${PUBLISHED}-m1`, course_kajabi_id: PUBLISHED, position: 1, title: 'Module 1', publishing_option: 'draft' },
    ])
    await bronze.from('kajabi_course_lessons').insert([
      { kajabi_id: `${PUBLISHED}-l1`, course_kajabi_id: PUBLISHED, module_kajabi_id: `${PUBLISHED}-w1`, position: 1, title: 'Published in locked', publishing_option: 'published', video_media_id: 'v1', content_fetched_at: now.toISOString() },
      { kajabi_id: `${PUBLISHED}-l2`, course_kajabi_id: PUBLISHED, module_kajabi_id: `${PUBLISHED}-m1`, position: 1, title: 'Draft one', publishing_option: 'draft' },
      { kajabi_id: `${PUBLISHED}-l3`, course_kajabi_id: PUBLISHED, position: 1, title: 'Loose open', publishing_option: 'published' },
    ])
    await bronze.from('kajabi_course_lessons').insert({ kajabi_id: `${UNPUBLISHED}-l1`, course_kajabi_id: UNPUBLISHED, position: 1, title: 'U', publishing_option: 'published' })

    const { data: course } = await supabase
      .from('courses')
      .insert({ slug: `admin-published-${ts}`, title: 'Admin Published', source_key: PUBLISHED, access_duration: '1 year', launch_at: days(10) })
      .select('id')
      .single()
    ids.course = course!.id
    const { data: members } = await supabase
      .from('members')
      .insert(['now', 'soon', 'over'].map((w) => ({ name: `Adm ${w}`, email: `adm-${w}-${ts}@example.com`, joined_at: now.toISOString(), status: 'active' })))
      .select('id, email')
    const id = (w: string) => members!.find((m) => m.email === `adm-${w}-${ts}@example.com`)!.id
    const { error } = await supabase.from('course_access').insert([
      { member_id: id('now'), course_id: ids.course, starts_at: days(-5), ends_at: days(300), origin: 'purchase' },
      { member_id: id('soon'), course_id: ids.course, starts_at: days(10), ends_at: days(375), origin: 'purchase' },
      { member_id: id('over'), course_id: ids.course, starts_at: days(-500), ends_at: days(-100), origin: 'purchase' },
    ])
    expect(error).toBeNull()
  })
  afterAll(cleanup)

  describe('loadAdminCourses', () => {
    it('lists a published course with its settings, access counts and lesson states', async () => {
      const row = (await loadAdminCourses(supabase, now)).find((c) => c.kajabiId === PUBLISHED)!
      // The interval comes back as ISO or Postgres text depending on the connection; it reads the same.
      expect(row.published).toMatchObject({ slug: `admin-published-${ts}` })
      expect(accessLabel(row.published!.accessDuration)).toBe('1 year')
      expect(new Date(row.published!.launchAt!).getTime()).toBeGreaterThan(now.getTime())
      expect(row.access).toEqual({ current: 1, upcoming: 1, ended: 1 })
      expect(row.totals).toEqual({ open: 1, coming_soon: 1, hidden: 1 })
    })

    it('lists an unpublished course with the slug publishing would use, and no access', async () => {
      const row = (await loadAdminCourses(supabase, now)).find((c) => c.kajabiId === UNPUBLISHED)!
      expect(row).toMatchObject({ published: null, slug: `admin-unpublished-${ts}`, access: { current: 0, upcoming: 0, ended: 0 } })
    })

    it('puts published courses first', async () => {
      const rows = await loadAdminCourses(supabase, now)
      expect(rows.findIndex((c) => c.kajabiId === PUBLISHED)).toBeLessThan(rows.findIndex((c) => c.kajabiId === UNPUBLISHED))
    })
  })

  describe('Hub-owned courses', () => {
    const HUB = `test-adm-hub-${ts}`
    let hubId: string
    beforeAll(async () => {
      const { data } = await supabase.from('courses').insert({ slug: HUB, title: `Admin Hub ${ts}`, source: 'hub', description: 'Made in the Hub.', access_duration: '6 months', launch_at: days(5) }).select('id').single()
      hubId = data!.id
      await supabase.from('course_lessons').insert([
        { course_id: hubId, title: 'Open one', position: 1, state: 'open' },
        { course_id: hubId, title: 'Open two', position: 2, state: 'open' },
        { course_id: hubId, title: 'Soon', position: 3, state: 'coming_soon' },
        { course_id: hubId, title: 'Draft', position: 4, state: 'hidden' },
      ])
      const { data: member } = await supabase.from('members').insert({ name: 'Adm Hub', email: `adm-hub-${ts}@example.com`, joined_at: now.toISOString(), status: 'active' }).select('id').single()
      await supabase.from('course_access').insert({ member_id: member!.id, course_id: hubId, starts_at: days(-1), ends_at: days(100), origin: 'purchase' })
    })
    afterAll(async () => {
      await supabase.from('courses').delete().eq('id', hubId)
    })

    it('are in the list beside the imported ones, marked as the Hub\'s, with their lesson states and access', async () => {
      const row = (await loadAdminCourses(supabase, now)).find((c) => c.kajabiId === hubId)!
      expect(row).toMatchObject({ source: 'hub', title: `Admin Hub ${ts}`, slug: HUB, totals: { open: 2, coming_soon: 1, hidden: 1 }, access: { current: 1, upcoming: 0, ended: 0 } })
      expect(row.published).toMatchObject({ slug: HUB })
      expect(accessLabel(row.published!.accessDuration)).toBe('6 months')
      expect((await loadAdminCourses(supabase, now)).find((c) => c.kajabiId === PUBLISHED)!.source).toBe('kajabi')
    })

    it('load for their own page, with the details the form edits', async () => {
      const course = (await loadHubCourse(supabase, hubId, now))!
      expect(course).toMatchObject({ id: hubId, title: `Admin Hub ${ts}`, slug: HUB, description: 'Made in the Hub.', programId: null, access: { current: 1, upcoming: 0, ended: 0 } })
      expect(new Date(course.launchAt!).getTime()).toBeGreaterThan(now.getTime())
    })

    it('are null for a course imported from Kajabi, even by its own id, and for an unknown one', async () => {
      const { data: imported } = await supabase.from('courses').select('id').eq('source_key', PUBLISHED).single()
      expect(await loadHubCourse(supabase, imported!.id, now)).toBeNull()
      expect(await loadHubCourse(supabase, 'crs_AAAAAAAAAAA1', now)).toBeNull()
    })

    it("give the tab their own name, and nothing for an imported course's id or an unknown one", async () => {
      expect(await loadAdminCourseTitle(supabase, hubId)).toBe(`Admin Hub ${ts}`)
      const { data: imported } = await supabase.from('courses').select('id').eq('source_key', PUBLISHED).single()
      expect(await loadAdminCourseTitle(supabase, imported!.id)).toBeNull()
      expect(await loadAdminCourseTitle(supabase, 'crs_AAAAAAAAAAA1')).toBeNull()
    })
  })

  describe('loadAdminCourseTitle', () => {
    it("is a course's name for the browser tab, and null for one Kajabi does not have", async () => {
      expect(await loadAdminCourseTitle(supabase, PUBLISHED)).toBe(`Admin Published ${ts}`)
      expect(await loadAdminCourseTitle(supabase, 'no-such-course')).toBeNull()
    })
  })

  describe('loadAdminLesson', () => {
    const lessonId = `${PUBLISHED}-l1`

    it("gives the lesson with its state, the modules above it, the course's module paths and its downloads", async () => {
      await bronze.from('kajabi_course_lessons').update({ body_html: '<p>Hey</p><script>alert(1)</script>', thumbnail_url: 'https://example.com/t.jpg', video_duration_seconds: 410 }).eq('kajabi_id', lessonId)
      await bronze.from('kajabi_lesson_files').insert({ kajabi_id: `${PUBLISHED}-f1`, lesson_kajabi_id: lessonId, filename: 'Tracker.pdf', size_bytes: 2048 })

      const detail = (await loadAdminLesson(supabase, PUBLISHED, lessonId))!
      expect(detail.course).toEqual({ kajabiId: PUBLISHED, title: `Admin Published ${ts}` })
      expect(detail.lesson).toMatchObject({ title: 'Published in locked', publishingOption: 'published', state: 'coming_soon', reason: 'Inside “Module 2” (Locked)', hasVideo: true, videoDurationSeconds: 410, thumbnailSrc: 'https://example.com/t.jpg' })
      // Never Kajabi's raw HTML.
      expect(detail.lesson.bodyHtml).toBe('<p>Hey</p>')
      expect(detail.trail.map((t) => t.title)).toEqual(['Module 2', 'Week 1'])
      expect(detail.modules.map((m) => m.path)).toEqual(['Module 1', 'Module 2', 'Module 2 / Week 1'])
      expect(detail.files).toEqual([{ filename: 'Tracker.pdf', sizeBytes: 2048 }])
    })

    it("has no module trail for a lesson outside every module, and no Hub link until the lesson is in the Hub", async () => {
      const loose = (await loadAdminLesson(supabase, PUBLISHED, `${PUBLISHED}-l3`))!
      expect(loose.trail).toEqual([])
      expect(loose.hub).toBeNull()
      expect(loose.lesson.hasVideo).toBe(false)
    })

    it("links the lesson to its Hub page once it is there", async () => {
      const { data: hub } = await supabase.from('course_lessons').insert({ course_id: ids.course, title: 'Published in locked', position: 1, state: 'coming_soon', source_key: lessonId }).select('id').single()
      const detail = (await loadAdminLesson(supabase, PUBLISHED, lessonId))!
      expect(detail.hub).toEqual({ slug: `admin-published-${ts}`, lessonId: hub!.id })
      // Other tests insert the same Hub lesson.
      await supabase.from('course_lessons').delete().eq('id', hub!.id)
    })

    it("gives the Hub lesson's video, what plays it and whether it is ready, and none before the lesson has one", async () => {
      const { data: video } = await supabase.from('videos').insert({ source_kind: 'kajabi', source_key: `${PUBLISHED}-media`, status: 'ready', mux_playback_id: 'pb-test', duration_seconds: 410 }).select('id').single()
      const { data: hub } = await supabase.from('course_lessons').insert({ course_id: ids.course, title: 'Published in locked', position: 1, state: 'coming_soon', source_key: lessonId }).select('id').single()
      expect((await loadAdminLesson(supabase, PUBLISHED, lessonId))!.video).toBeNull()

      await supabase.from('course_lessons').update({ video_id: video!.id }).eq('id', hub!.id)
      expect((await loadAdminLesson(supabase, PUBLISHED, lessonId))!.video).toEqual({ status: 'ready', playbackId: 'pb-test' })
      // Other tests insert the same Hub lesson.
      await supabase.from('course_lessons').delete().eq('id', hub!.id)
      await supabase.from('videos').delete().eq('id', video!.id)
    })

    it('is null for a lesson in another course, one that does not exist, or a course Kajabi does not have', async () => {
      expect(await loadAdminLesson(supabase, UNPUBLISHED, lessonId)).toBeNull()
      expect(await loadAdminLesson(supabase, PUBLISHED, 'no-such-lesson')).toBeNull()
      expect(await loadAdminLesson(supabase, 'no-such-course', lessonId)).toBeNull()
    })
  })

  describe('loadAdminCourse', () => {
    it('explains a published lesson inside a locked module, and flags what the content step found', async () => {
      const detail = (await loadAdminCourse(supabase, PUBLISHED, now))!
      const module2 = detail.explained.modules.find((m) => m.title === 'Module 2')!
      expect(module2).toMatchObject({ state: 'coming_soon', reason: 'Locked in Kajabi' })
      expect(module2.children[0].lessons[0]).toMatchObject({ title: 'Published in locked', state: 'coming_soon', reason: 'Inside “Module 2” (Locked)' })
      expect(detail.content[`${PUBLISHED}-l1`]).toEqual({ hasText: true, hasVideo: true })
      expect(detail.content[`${PUBLISHED}-l2`]).toEqual({ hasText: false, hasVideo: false })
      expect(detail.explained.loose).toMatchObject([{ title: 'Loose open', state: 'open' }])
    })

    it('maps Kajabi lessons to their Hub lessons, only for lessons that are in the Hub', async () => {
      const { data: hub } = await supabase.from('course_lessons').insert({ course_id: ids.course, title: 'Published in locked', position: 1, state: 'coming_soon', source_key: `${PUBLISHED}-l1` }).select('id').single()
      const detail = (await loadAdminCourse(supabase, PUBLISHED, now))!
      expect(detail.hubLessonIds).toEqual({ [`${PUBLISHED}-l1`]: hub!.id })
      // An unpublished course has none.
      expect((await loadAdminCourse(supabase, UNPUBLISHED, now))!.hubLessonIds).toEqual({})
    })

    it('gives the builder its details and when the structure was last imported, newest row first', async () => {
      await supabase.from('courses').update({ description: 'Learn to write.' }).eq('id', ids.course)
      const newest = '2031-05-06T12:00:00.000Z'
      await bronze.from('kajabi_course_lessons').update({ fetched_at: newest }).eq('kajabi_id', `${PUBLISHED}-l3`)
      const detail = (await loadAdminCourse(supabase, PUBLISHED, now))!
      expect(detail.details).toEqual({ description: 'Learn to write.', includesMembership: null })
      expect(new Date(detail.lastImportedAt!).toISOString()).toBe(newest)
      // Not in the Hub yet: nothing to show beyond Kajabi's own data.
      const unpublished = (await loadAdminCourse(supabase, UNPUBLISHED, now))!
      expect(unpublished.details).toEqual({ description: null, includesMembership: null })
      expect(unpublished.lastImportedAt).not.toBeNull()
    })

    it('is null for a course Kajabi does not have', async () => {
      expect(await loadAdminCourse(supabase, 'no-such-course', now)).toBeNull()
    })
  })
})
