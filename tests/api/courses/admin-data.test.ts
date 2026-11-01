import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { loadAdminCourse, loadAdminCourseTitle, loadAdminLesson, loadAdminCourses, loadHubCourse, loadHubOutline } from '@/lib/courses/admin'
import { accessLabel } from '@/lib/courses/access-options'
import { createRepos } from "@/lib/data/repos";

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
    await supabase.from('courses').delete().in('source_key', [PUBLISHED, UNPUBLISHED])
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
    // What the Kajabi import makes for a course that is not published: a draft row.
    const { data: draft } = await supabase
      .from('courses')
      .insert({ slug: `admin-unpublished-${ts}`, title: 'Admin Unpublished', source_key: UNPUBLISHED, is_draft: true })
      .select('id')
      .single()
    ids.draft = draft!.id
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
      const row = (await loadAdminCourses(createRepos(supabase), now)).find((c) => c.id === ids.course)!
      // The interval comes back as ISO or Postgres text depending on the connection; it reads the same.
      expect(row.hub).toMatchObject({ slug: `admin-published-${ts}` })
      expect(accessLabel(row.hub!.accessDuration)).toBe('1 year')
      expect(new Date(row.hub!.launchAt!).getTime()).toBeGreaterThan(now.getTime())
      expect(row.access).toEqual({ current: 1, upcoming: 1, ended: 1 })
      expect(row.totals).toEqual({ open: 1, coming_soon: 1, hidden: 1 })
    })

    it('lists an unpublished course with the slug publishing would use, and no access', async () => {
      const row = (await loadAdminCourses(createRepos(supabase), now)).find((c) => c.id === ids.draft)!
      expect(row).toMatchObject({ id: ids.draft, isDraft: true, slug: `admin-unpublished-${ts}`, access: { current: 0, upcoming: 0, ended: 0 } })
    })

    it('has no id for an imported course that has no row yet, so nothing links to it', async () => {
      const NOROW = `test-adm-norow-${ts}`
      await bronze.from('kajabi_courses').insert({ kajabi_id: NOROW, title: `Admin No Row ${ts}`, raw_payload: {} })
      try {
        const row = (await loadAdminCourses(createRepos(supabase), now)).find((c) => c.title === `Admin No Row ${ts}`)!
        expect(row.id).toBeNull()
      } finally {
        await bronze.from('kajabi_courses').delete().eq('kajabi_id', NOROW)
      }
    })

    it('puts published courses first', async () => {
      const rows = await loadAdminCourses(createRepos(supabase), now)
      expect(rows.findIndex((c) => c.id === ids.course)).toBeLessThan(rows.findIndex((c) => c.id === ids.draft))
    })
  })

  describe('Hub-owned courses', () => {
    const HUB = `test-adm-hub-${ts}`
    let hubId: string
    beforeAll(async () => {
      const { data } = await supabase.from('courses').insert({ slug: HUB, title: `Admin Hub ${ts}`, source: 'hub', is_draft: false, description: 'Made in the Hub.', access_duration: '6 months', launch_at: days(5) }).select('id').single()
      hubId = data!.id
      await supabase.from('course_lessons').insert([
        // Their states follow from their settings and what is above them, whatever state is passed.
        { course_id: hubId, title: 'Open one', position: 1, publishing_option: 'published', source: 'hub' },
        { course_id: hubId, title: 'Open two', position: 2, publishing_option: 'published', source: 'hub' },
        { course_id: hubId, title: 'Soon', position: 3, publishing_option: 'locked', source: 'hub' },
        { course_id: hubId, title: 'Draft', position: 4, publishing_option: 'draft', source: 'hub' },
      ])
      const { data: member } = await supabase.from('members').insert({ name: 'Adm Hub', email: `adm-hub-${ts}@example.com`, joined_at: now.toISOString(), status: 'active' }).select('id').single()
      await supabase.from('course_access').insert({ member_id: member!.id, course_id: hubId, starts_at: days(-1), ends_at: days(100), origin: 'purchase' })
    })
    afterAll(async () => {
      await supabase.from('courses').delete().eq('id', hubId)
    })

    it('are in the list beside the imported ones, marked as the Hub\'s, with their lesson states and access', async () => {
      const row = (await loadAdminCourses(createRepos(supabase), now)).find((c) => c.id === hubId)!
      expect(row).toMatchObject({ source: 'hub', title: `Admin Hub ${ts}`, slug: HUB, totals: { open: 2, coming_soon: 1, hidden: 1 }, access: { current: 1, upcoming: 0, ended: 0 } })
      expect(row.hub).toMatchObject({ slug: HUB })
      expect(accessLabel(row.hub!.accessDuration)).toBe('6 months')
      expect((await loadAdminCourses(createRepos(supabase), now)).find((c) => c.id === ids.course)!.source).toBe('kajabi')
    })

    it('are listed once when taken over from Kajabi, as the Hub\'s, not again from the Kajabi copy', async () => {
      const key = `test-adm-over-${ts}`
      await bronze.from('kajabi_courses').insert({ kajabi_id: key, title: `Taken Over ${ts}`, raw_payload: {} })
      const { data } = await supabase.from('courses').insert({ slug: `taken-over-${ts}`, title: `Taken Over ${ts}`, source: 'hub', source_key: key }).select('id').single()
      try {
        const rows = (await loadAdminCourses(createRepos(supabase), now)).filter((c) => c.title === `Taken Over ${ts}`)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ source: 'hub', id: data!.id })
      } finally {
        await supabase.from('courses').delete().eq('id', data!.id)
        await bronze.from('kajabi_courses').delete().eq('kajabi_id', key)
      }
    })

    it('load for their own page, with the details the form edits', async () => {
      const course = (await loadHubCourse(createRepos(supabase), hubId, now))!
      expect(course).toMatchObject({ id: hubId, title: `Admin Hub ${ts}`, slug: HUB, description: 'Made in the Hub.', programId: null, access: { current: 1, upcoming: 0, ended: 0 } })
      expect(new Date(course.launchAt!).getTime()).toBeGreaterThan(now.getTime())
    })

    it("give their outline: modules, submodules and lessons in position order, with what each has, and nothing of another course's", async () => {
      const { data: m2 } = await supabase.from('course_modules').insert({ course_id: hubId, title: 'Second', position: 2, publishing_option: 'published', source: 'hub' }).select('id').single()
      const { data: m1 } = await supabase.from('course_modules').insert({ course_id: hubId, title: 'First', position: 1, publishing_option: 'published', source: 'hub' }).select('id').single()
      const { data: week } = await supabase.from('course_modules').insert({ course_id: hubId, parent_id: m1!.id, title: 'Week', position: 1, publishing_option: 'published', source: 'hub' }).select('id').single()
      await supabase.from('course_lessons').insert([
        { course_id: hubId, module_id: week!.id, title: 'With text', position: 2, publishing_option: 'published', excerpt: 'Hello', source: 'hub' },
        { course_id: hubId, module_id: week!.id, title: 'Plain', position: 1, publishing_option: 'draft', source: 'hub' },
        { course_id: hubId, module_id: m2!.id, title: 'In second', position: 1, publishing_option: 'published', source: 'hub' },
      ])
      const outline = await loadHubOutline(createRepos(supabase), hubId)
      expect(outline.modules.map((m) => m.title)).toEqual(['First', 'Second'])
      expect(outline.modules[0].children.map((c) => c.title)).toEqual(['Week'])
      expect(outline.modules[0].children[0].lessons.map((l) => l.title)).toEqual(['Plain', 'With text'])
      expect(outline.modules[1].lessons[0]).toMatchObject({ title: 'In second', state: 'open', publishingOption: 'published' })
      // What follows reads as following, and a draft is hidden; the states come from one rule for both owners.
      expect(outline.modules[0]).toMatchObject({ publishingOption: 'published', state: 'open', reason: 'Published' })
      expect(outline.modules[0].children[0].lessons[0]).toMatchObject({ title: 'Plain', state: 'hidden', reason: 'Draft in the Hub' })
      const ids = Object.fromEntries(outline.modules[0].children[0].lessons.map((l) => [l.title, l.kajabiId]))
      expect(outline.content[ids['With text']]).toEqual({ hasText: true, hasVideo: false })
      expect(outline.content[ids['Plain']]).toEqual({ hasText: false, hasVideo: false })
      // Loose lessons in the Hub course from the earlier test of this block are in it too, and no other course's are.
      expect((await loadHubOutline(createRepos(supabase), 'crs_AAAAAAAAAAA1')).modules).toEqual([])
    })

    it("give a lesson's own page from the Hub's rows: where it sits, what it says, why it is hidden or open", async () => {
      const { data: lessons } = await supabase.from('course_lessons').select('id, title').eq('course_id', hubId)
      const withText = lessons!.find((l) => l.title === 'With text')!
      const plain = lessons!.find((l) => l.title === 'Plain')!
      await supabase.from('course_lessons').update({ body_html: '<p>Hello <script>x</script></p>' }).eq('id', withText.id)

      const detail = (await loadAdminLesson(createRepos(supabase), hubId, withText.id))!
      expect(detail).toMatchObject({
        editable: true,
        course: { id: hubId, title: `Admin Hub ${ts}` },
        lesson: { kajabiId: withText.id, title: 'With text', publishingOption: 'published', state: 'open', hasVideo: false, contentFetchedAt: null },
        hub: { slug: HUB, lessonId: withText.id },
        video: null,
        files: [],
      })
      expect(detail.lesson.bodyHtml).toContain('Hello')
      expect(detail.lesson.bodyHtml).not.toContain('script')
      expect(detail.trail.map((t) => t.title)).toEqual(['First', 'Week'])
      expect(detail.modules.map((m) => m.path)).toEqual(['First', 'First / Week', 'Second'])

      expect((await loadAdminLesson(createRepos(supabase), hubId, plain.id))!.lesson).toMatchObject({ state: 'hidden', reason: 'Draft in the Hub', publishingOption: 'draft' })
    })

    it("give no lesson page for another course's lesson, an unknown one, or an id that isn't one", async () => {
      const { data: lessons } = await supabase.from('course_lessons').select('id').eq('course_id', hubId).limit(1)
      expect(await loadAdminLesson(createRepos(supabase), ids.course, lessons![0].id)).toBeNull()
      expect(await loadAdminLesson(createRepos(supabase), hubId, 'les_AAAAAAAAAAA1')).toBeNull()
      expect(await loadAdminLesson(createRepos(supabase), hubId, 'nope')).toBeNull()
    })

    it('are null for a course imported from Kajabi, even by its own id, and for an unknown one', async () => {
      const { data: imported } = await supabase.from('courses').select('id').eq('source_key', PUBLISHED).single()
      expect(await loadHubCourse(createRepos(supabase), imported!.id, now)).toBeNull()
      expect(await loadHubCourse(createRepos(supabase), 'crs_AAAAAAAAAAA1', now)).toBeNull()
    })

    it("give the tab their own name, and nothing for an unknown one", async () => {
      expect(await loadAdminCourseTitle(createRepos(supabase), hubId)).toBe(`Admin Hub ${ts}`)
      const { data: imported } = await supabase.from('courses').select('id').eq('source_key', PUBLISHED).single()
      expect(await loadAdminCourseTitle(createRepos(supabase), imported!.id)).toBe('Admin Published')
      expect(await loadAdminCourseTitle(createRepos(supabase), 'crs_AAAAAAAAAAA1')).toBeNull()
    })
  })

  describe('loadAdminCourseTitle', () => {
    it("is a course's name for the browser tab by its Hub id, and null for a Kajabi id or an unknown one", async () => {
      expect(await loadAdminCourseTitle(createRepos(supabase), ids.course)).toBe('Admin Published')
      expect(await loadAdminCourseTitle(createRepos(supabase), ids.draft)).toBe('Admin Unpublished')
      expect(await loadAdminCourseTitle(createRepos(supabase), PUBLISHED)).toBeNull()
      expect(await loadAdminCourseTitle(createRepos(supabase), 'no-such-course')).toBeNull()
    })
  })

  describe('loadAdminLesson', () => {
    const lessonId = `${PUBLISHED}-l1`
    // A lesson has a builder page once it is in the Hub, and its address is the Hub's ids.
    let hubLesson: string
    let hubLoose: string
    beforeAll(async () => {
      const { data } = await supabase
        .from('course_lessons')
        .insert([
          { course_id: ids.course, title: 'Published in locked', position: 1, state: 'coming_soon', source_key: lessonId },
          { course_id: ids.course, title: 'Loose open', position: 2, state: 'open', source_key: `${PUBLISHED}-l3` },
        ])
        .select('id, source_key')
      hubLesson = data!.find((l) => l.source_key === lessonId)!.id
      hubLoose = data!.find((l) => l.source_key === `${PUBLISHED}-l3`)!.id
    })
    afterAll(async () => {
      await supabase.from('course_lessons').delete().in('id', [hubLesson, hubLoose])
    })

    it("gives the lesson with its state, the modules above it, the course's module paths and its downloads", async () => {
      await bronze.from('kajabi_course_lessons').update({ body_html: '<p>Hey</p><script>alert(1)</script>', thumbnail_url: 'https://example.com/t.jpg', video_duration_seconds: 410 }).eq('kajabi_id', lessonId)
      await bronze.from('kajabi_lesson_files').insert({ kajabi_id: `${PUBLISHED}-f1`, lesson_kajabi_id: lessonId, filename: 'Tracker.pdf', size_bytes: 2048 })

      const detail = (await loadAdminLesson(createRepos(supabase), ids.course, hubLesson))!
      expect(detail.course).toEqual({ id: ids.course, title: `Admin Published ${ts}` })
      expect(detail.lesson).toMatchObject({ title: 'Published in locked', publishingOption: 'published', state: 'coming_soon', reason: 'Inside “Module 2” (Locked)', hasVideo: true, videoDurationSeconds: 410, thumbnailSrc: 'https://example.com/t.jpg' })
      // Never Kajabi's raw HTML.
      expect(detail.lesson.bodyHtml).toBe('<p>Hey</p>')
      expect(detail.trail.map((t) => t.title)).toEqual(['Module 2', 'Week 1'])
      expect(detail.modules.map((m) => m.path)).toEqual(['Module 1', 'Module 2', 'Module 2 / Week 1'])
      expect(detail.files).toEqual([{ id: null, filename: 'Tracker.pdf', sizeBytes: 2048 }])
      expect(detail.hub).toEqual({ slug: `admin-published-${ts}`, lessonId: hubLesson })
    })

    it('has no module trail for a lesson outside every module', async () => {
      const loose = (await loadAdminLesson(createRepos(supabase), ids.course, hubLoose))!
      expect(loose.trail).toEqual([])
      expect(loose.lesson.hasVideo).toBe(false)
    })

    it("gives the Hub lesson's video, what plays it and whether it is ready, and none before the lesson has one", async () => {
      const { data: video } = await supabase.from('videos').insert({ source_kind: 'kajabi', source_key: `${PUBLISHED}-media`, status: 'ready', mux_playback_id: 'pb-test', duration_seconds: 410 }).select('id').single()
      expect((await loadAdminLesson(createRepos(supabase), ids.course, hubLesson))!.video).toBeNull()

      await supabase.from('course_lessons').update({ video_id: video!.id }).eq('id', hubLesson)
      expect((await loadAdminLesson(createRepos(supabase), ids.course, hubLesson))!.video).toEqual({ status: 'ready', playbackId: 'pb-test' })
      await supabase.from('course_lessons').update({ video_id: null }).eq('id', hubLesson)
      await supabase.from('videos').delete().eq('id', video!.id)
    })

    it('is null for a lesson of another course, an unknown lesson or course, and any Kajabi id', async () => {
      expect(await loadAdminLesson(createRepos(supabase), ids.draft, hubLesson)).toBeNull()
      expect(await loadAdminLesson(createRepos(supabase), ids.course, 'les_AAAAAAAAAAA1')).toBeNull()
      expect(await loadAdminLesson(createRepos(supabase), 'crs_AAAAAAAAAAA1', hubLesson)).toBeNull()
      expect(await loadAdminLesson(createRepos(supabase), PUBLISHED, hubLesson)).toBeNull()
      expect(await loadAdminLesson(createRepos(supabase), ids.course, lessonId)).toBeNull()
    })
  })

  describe('loadAdminCourse', () => {
    it('explains a published lesson inside a locked module, and flags what the content step found', async () => {
      const detail = (await loadAdminCourse(createRepos(supabase), ids.course, now))!
      const module2 = detail.explained.modules.find((m) => m.title === 'Module 2')!
      expect(module2).toMatchObject({ state: 'coming_soon', reason: 'Locked in Kajabi' })
      expect(module2.children[0].lessons[0]).toMatchObject({ title: 'Published in locked', state: 'coming_soon', reason: 'Inside “Module 2” (Locked)' })
      expect(detail.content[`${PUBLISHED}-l1`]).toEqual({ hasText: true, hasVideo: true })
      expect(detail.content[`${PUBLISHED}-l2`]).toEqual({ hasText: false, hasVideo: false })
      expect(detail.explained.loose).toMatchObject([{ title: 'Loose open', state: 'open' }])
    })

    it('maps Kajabi lessons to their Hub lessons, only for lessons that are in the Hub', async () => {
      const { data: hub } = await supabase.from('course_lessons').insert({ course_id: ids.course, title: 'Published in locked', position: 1, state: 'coming_soon', source_key: `${PUBLISHED}-l1` }).select('id').single()
      const detail = (await loadAdminCourse(createRepos(supabase), ids.course, now))!
      expect(detail.hubLessonIds).toEqual({ [`${PUBLISHED}-l1`]: hub!.id })
      // An unpublished course has none.
      expect((await loadAdminCourse(createRepos(supabase), ids.draft, now))!.hubLessonIds).toEqual({})
    })

    it('gives the builder its details and when the structure was last imported, newest row first', async () => {
      await supabase.from('courses').update({ description: 'Learn to write.' }).eq('id', ids.course)
      const newest = '2031-05-06T12:00:00.000Z'
      await bronze.from('kajabi_course_lessons').update({ fetched_at: newest }).eq('kajabi_id', `${PUBLISHED}-l3`)
      const detail = (await loadAdminCourse(createRepos(supabase), ids.course, now))!
      expect(detail.details).toEqual({ description: 'Learn to write.', includesMembership: null })
      expect(new Date(detail.lastImportedAt!).toISOString()).toBe(newest)
      // Not in the Hub yet: nothing to show beyond Kajabi's own data.
      const unpublished = (await loadAdminCourse(createRepos(supabase), ids.draft, now))!
      expect(unpublished.details).toEqual({ description: null, includesMembership: null })
      expect(unpublished.lastImportedAt).not.toBeNull()
    })

    it('is null for an unknown id and for a Kajabi id', async () => {
      expect(await loadAdminCourse(createRepos(supabase), 'crs_AAAAAAAAAAA1', now)).toBeNull()
      expect(await loadAdminCourse(createRepos(supabase), PUBLISHED, now)).toBeNull()
    })
  })
})
