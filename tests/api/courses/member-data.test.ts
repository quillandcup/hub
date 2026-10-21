import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { loadCourseList, loadCourseView, loadLessonView } from '@/lib/courses/member'

/**
 * What the member course pages read, against the real local database: access (current, ended,
 * none, staff), the outline and its progress, and what a lesson page gets (neighbours, video).
 * Rows are created under a run-unique slug and cleaned up by cascade from the course.
 */

const ts = Date.now()
const SLUG = `member-data-${ts}`
const emailOf = (who: string) => `member-data-${who}-${ts}@example.com`

describe('Course member data', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const now = new Date()
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
  const daysAhead = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString()

  const scope = (who: string, isAdminActing = false) => ({ memberId: ids[who], isAdminActing, now })

  beforeAll(async () => {
    const { data: members, error } = await supabase
      .from('members')
      .insert(['current', 'ended', 'none', 'staff'].map((who) => ({ name: `Member Data ${who}`, email: emailOf(who), joined_at: now.toISOString(), status: 'active' })))
      .select('id, email')
    expect(error).toBeNull()
    for (const who of ['current', 'ended', 'none', 'staff']) ids[who] = members!.find((m) => m.email === emailOf(who))!.id

    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `Member Data ${ts}`, source_key: SLUG }).select('id').single()
    ids.course = course!.id
    const { data: module } = await supabase.from('course_modules').insert({ course_id: ids.course, title: 'Month 1', position: 1, source_key: `${SLUG}-m` }).select('id').single()
    const { data: video } = await supabase.from('videos').insert({ source_kind: 'upload', source_key: SLUG, status: 'ready', mux_playback_id: 'pb-test' }).select('id').single()
    ids.video = video!.id
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, module_id: module!.id, title: 'A', position: 1, state: 'open', body_html: '<p>a</p>', video_id: ids.video, duration_seconds: 60, source_key: `${SLUG}-a` },
        { course_id: ids.course, module_id: module!.id, title: 'Soon', position: 2, state: 'coming_soon', source_key: `${SLUG}-soon` },
        { course_id: ids.course, module_id: module!.id, title: 'B', position: 3, state: 'open', source_key: `${SLUG}-b` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[`lesson${l.title}`] = l.id

    const inserts = await Promise.all([supabase.from('course_access').insert([
      { member_id: ids.current, course_id: ids.course, starts_at: daysAgo(10), ends_at: daysAhead(300), origin: 'purchase' },
      { member_id: ids.ended, course_id: ids.course, starts_at: daysAgo(500), ends_at: daysAgo(100), origin: 'purchase' },
    ]), supabase.from('lesson_progress').insert([
      { member_id: ids.current, lesson_id: ids.lessonA, completed_at: daysAgo(1), last_position_seconds: 0 },
      { member_id: ids.ended, lesson_id: ids.lessonA, completed_at: daysAgo(200), last_position_seconds: 0 },
      { member_id: ids.ended, lesson_id: ids.lessonB, completed_at: null, last_position_seconds: 5 },
    ])])
    for (const { error: insertError } of inserts) expect(insertError).toBeNull()

    // An ended course whose title sorts before the current one, for the list order.
    const { data: old } = await supabase.from('courses').insert({ slug: `${SLUG}-old`, title: `AAA Old ${ts}`, source_key: `${SLUG}-old` }).select('id').single()
    ids.oldCourse = old!.id
    const { error: oldError } = await supabase.from('course_access').insert({ member_id: ids.current, course_id: ids.oldCourse, starts_at: daysAgo(900), ends_at: daysAgo(200), origin: 'purchase' })
    expect(oldError).toBeNull()
  })

  afterAll(async () => {
    await supabase.from('courses').delete().eq('id', ids.oldCourse)
    await supabase.from('courses').delete().eq('id', ids.course) // cascades modules, lessons, access, progress
    await supabase.from('videos').delete().eq('id', ids.video)
    await supabase.from('members').delete().like('email', `member-data-%-${ts}@example.com`)
  })

  describe('loadCourseList', () => {
    it("lists a member's course with progress against available lessons only", async () => {
      const mine = (await loadCourseList(supabase, scope('current'))).filter((i) => i.course.slug === SLUG)
      expect(mine).toHaveLength(1)
      expect(mine[0].access.kind).toBe('open')
      expect(mine[0].progress).toMatchObject({ available: 2, completed: 1, continueLessonId: ids.lessonB, allDone: false })
    })

    it('still lists a course whose access ended, marked ended, with their progress', async () => {
      const [item] = (await loadCourseList(supabase, scope('ended'))).filter((i) => i.course.slug === SLUG)
      expect(item.access.kind).toBe('ended')
      expect(item.progress.completed).toBe(1)
    })

    it('lists current courses before ended ones, even when the ended one sorts first by title', async () => {
      const slugs = (await loadCourseList(supabase, scope('current'))).map((i) => i.course.slug).filter((slug) => slug.startsWith(SLUG))
      expect(slugs).toEqual([SLUG, `${SLUG}-old`])
    })

    it('lists nothing for a member with no access, and everything for staff acting as themselves', async () => {
      expect((await loadCourseList(supabase, scope('none'))).filter((i) => i.course.slug === SLUG)).toEqual([])
      const staff = (await loadCourseList(supabase, scope('staff', true))).filter((i) => i.course.slug === SLUG)
      expect(staff).toHaveLength(1)
      expect(staff[0].access.kind).toBe('admin')
    })

    it("treats staff in sudo as the member they act as: only that member's courses", async () => {
      expect((await loadCourseList(supabase, scope('none', false))).filter((i) => i.course.slug === SLUG)).toEqual([])
    })
  })

  describe('loadCourseView', () => {
    it('is null for an unknown slug', async () => {
      expect(await loadCourseView(supabase, 'no-such-course', scope('current'))).toBeNull()
    })

    it('shows nothing of the course to someone without access', async () => {
      const view = await loadCourseView(supabase, SLUG, scope('none'))
      expect(view).toMatchObject({ access: { kind: 'none' }, outline: null, progress: null })
      expect(view!.course.title).toBe(`Member Data ${ts}`)
    })

    it('gives the outline in order, with coming-soon lessons included', async () => {
      const view = await loadCourseView(supabase, SLUG, scope('current'))
      expect(view!.outline!.lessons.map((l) => l.title)).toEqual(['A', 'Soon', 'B'])
      expect(view!.outline!.lessons.map((l) => l.state)).toEqual(['open', 'coming_soon', 'open'])
      expect([...view!.completed]).toEqual([ids.lessonA])
    })
  })

  describe('loadLessonView', () => {
    it('gives an open lesson with neighbours that skip coming soon, and its video', async () => {
      const result = await loadLessonView(supabase, SLUG, ids.lessonA, scope('current'))
      expect(result.kind).toBe('ok')
      if (result.kind !== 'ok') return
      expect(result.lesson).toMatchObject({ title: 'A', body_html: '<p>a</p>' })
      expect(result.neighbors.previous).toBeNull()
      expect(result.neighbors.next?.id).toBe(ids.lessonB)
      expect(result.completed).toBe(true)
      expect(result.video).toEqual({ id: ids.video, status: 'ready', playbackId: 'pb-test' })
      expect(result.resumeSeconds).toBe(0)
    })

    it("gives where the member left off, but not a trivial position or someone else's", async () => {
      await supabase.from('lesson_progress').update({ last_position_seconds: 42.5 }).eq('member_id', ids.current).eq('lesson_id', ids.lessonA)
      const resumed = await loadLessonView(supabase, SLUG, ids.lessonA, scope('current'))
      expect(resumed.kind === 'ok' && resumed.resumeSeconds).toBe(42.5)

      await supabase.from('lesson_progress').update({ last_position_seconds: 3 }).eq('member_id', ids.current).eq('lesson_id', ids.lessonA)
      const barely = await loadLessonView(supabase, SLUG, ids.lessonA, scope('current'))
      expect(barely.kind === 'ok' && barely.resumeSeconds).toBe(0)

      const staff = await loadLessonView(supabase, SLUG, ids.lessonA, scope('staff', true))
      expect(staff.kind === 'ok' && staff.resumeSeconds).toBe(0)
      await supabase.from('lesson_progress').update({ last_position_seconds: 0 }).eq('member_id', ids.current).eq('lesson_id', ids.lessonA)
    })

    it("gives the lesson's downloads in order, and none for a lesson without any", async () => {
      await supabase.from('course_lesson_files').insert([
        { lesson_id: ids.lessonA, source_key: `${SLUG}-f2`, filename: 'Second.pdf', storage_path: 'x/second', position: 2, size_bytes: 20 },
        { lesson_id: ids.lessonA, source_key: `${SLUG}-f1`, filename: 'First.pdf', storage_path: 'x/first', position: 1, size_bytes: 10 },
      ])
      const withFiles = await loadLessonView(supabase, SLUG, ids.lessonA, scope('current'))
      expect(withFiles.kind === 'ok' && withFiles.files.map((f) => [f.filename, f.size_bytes])).toEqual([['First.pdf', 10], ['Second.pdf', 20]])
      // The storage path is never part of what the page gets.
      expect(withFiles.kind === 'ok' && withFiles.files[0]).not.toHaveProperty('storage_path')

      const without = await loadLessonView(supabase, SLUG, ids.lessonB, scope('current'))
      expect(without.kind === 'ok' && without.files).toEqual([])
    })

    it('does not open a coming-soon lesson for a member, or for staff in sudo', async () => {
      expect((await loadLessonView(supabase, SLUG, ids.lessonSoon, scope('current'))).kind).toBe('coming_soon')
      expect((await loadLessonView(supabase, SLUG, ids.lessonSoon, scope('staff', false))).kind).toBe('no_access')
    })

    it('previews a coming-soon lesson for staff, stepping through unreleased lessons too', async () => {
      const result = await loadLessonView(supabase, SLUG, ids.lessonSoon, scope('staff', true))
      expect(result.kind).toBe('ok')
      if (result.kind !== 'ok') return
      expect(result.preview).toBe(true)
      expect(result.neighbors.previous?.id).toBe(ids.lessonA)
      expect(result.neighbors.next?.id).toBe(ids.lessonB)
      // An open lesson is not a preview, and staff step through coming-soon ones from it.
      const open = await loadLessonView(supabase, SLUG, ids.lessonA, scope('staff', true))
      expect(open.kind === 'ok' && open.preview).toBe(false)
      expect(open.kind === 'ok' && open.neighbors.next?.id).toBe(ids.lessonSoon)
    })

    it('does not open lessons once access ended, or without access', async () => {
      expect((await loadLessonView(supabase, SLUG, ids.lessonA, scope('ended'))).kind).toBe('no_access')
      expect((await loadLessonView(supabase, SLUG, ids.lessonA, scope('none'))).kind).toBe('no_access')
    })

    it('opens any lesson for staff, and answers not found for a lesson of another course or an unknown one', async () => {
      expect((await loadLessonView(supabase, SLUG, ids.lessonA, scope('staff', true))).kind).toBe('ok')
      expect((await loadLessonView(supabase, SLUG, '00000000-0000-4000-a000-000000000000', scope('current'))).kind).toBe('not_found')
      expect((await loadLessonView(supabase, 'no-such-course', ids.lessonA, scope('current'))).kind).toBe('not_found')
    })
  })
})
