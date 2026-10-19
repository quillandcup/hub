import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { loadAdminCourse, loadAdminCourses } from '@/lib/courses/admin'
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

    it('is null for a course Kajabi does not have', async () => {
      expect(await loadAdminCourse(supabase, 'no-such-course', now)).toBeNull()
    })
  })
})
