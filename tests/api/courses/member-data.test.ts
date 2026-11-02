import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { loadCourseList, loadCourseView, loadLessonView, loadMemberCourseAccess } from '@/lib/courses/member'
import { createRepos } from "@/lib/data/repos";

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
      const mine = (await loadCourseList(createRepos(supabase), scope('current'))).filter((i) => i.course.slug === SLUG)
      expect(mine).toHaveLength(1)
      expect(mine[0].access.kind).toBe('open')
      expect(mine[0].progress).toMatchObject({ available: 2, completed: 1, continueLessonId: ids.lessonB, allDone: false })
    })

    it('still lists a course whose access ended, marked ended, with their progress', async () => {
      const [item] = (await loadCourseList(createRepos(supabase), scope('ended'))).filter((i) => i.course.slug === SLUG)
      expect(item.access.kind).toBe('ended')
      expect(item.progress.completed).toBe(1)
    })

    it('lists current courses before ended ones, even when the ended one sorts first by title', async () => {
      const slugs = (await loadCourseList(createRepos(supabase), scope('current'))).map((i) => i.course.slug).filter((slug) => slug.startsWith(SLUG))
      expect(slugs).toEqual([SLUG, `${SLUG}-old`])
    })

    it('lists nothing for a member with no access, and everything for staff acting as themselves', async () => {
      expect((await loadCourseList(createRepos(supabase), scope('none'))).filter((i) => i.course.slug === SLUG)).toEqual([])
      const staff = (await loadCourseList(createRepos(supabase), scope('staff', true))).filter((i) => i.course.slug === SLUG)
      expect(staff).toHaveLength(1)
      expect(staff[0].access.kind).toBe('admin')
    })

    it('lists a draft course for staff acting as themselves, marked as a draft, and for no one else', async () => {
      const draftSlug = `${SLUG}-draft`
      const { data: draft } = await supabase.from('courses').insert({ slug: draftSlug, title: `Draft ${ts}`, source_key: draftSlug, is_draft: true }).select('id').single()
      // Access rows can exist for a draft (a course taken back to a draft keeps them); they open nothing.
      await supabase.from('course_access').insert({ member_id: ids.current, course_id: draft!.id, starts_at: daysAgo(10), ends_at: daysAhead(300), origin: 'purchase' })
      try {
        const staff = (await loadCourseList(createRepos(supabase), scope('staff', true))).filter((i) => i.course.slug === draftSlug)
        expect(staff).toHaveLength(1)
        expect(staff[0].course.is_draft).toBe(true)
        expect((await loadCourseList(createRepos(supabase), scope('current'))).filter((i) => i.course.slug === draftSlug)).toEqual([])
        expect((await loadCourseList(createRepos(supabase), scope('staff', false))).filter((i) => i.course.slug === draftSlug)).toEqual([])
        expect(await loadMemberCourseAccess(createRepos(supabase), scope('current'), draft!.id)).toEqual({ kind: 'none' })
        expect((await loadMemberCourseAccess(createRepos(supabase), scope('staff', true), draft!.id)).kind).toBe('admin')
        expect(await loadCourseView(createRepos(supabase), draftSlug, scope('current'))).toBeNull()
        expect(await loadCourseView(createRepos(supabase), draftSlug, scope('staff', false))).toBeNull()
        expect((await loadCourseView(createRepos(supabase), draftSlug, scope('staff', true)))!.course.is_draft).toBe(true)
        // Publishing it opens it to the member who has access.
        await supabase.from('courses').update({ is_draft: false }).eq('id', draft!.id)
        expect((await loadCourseView(createRepos(supabase), draftSlug, scope('current')))!.access.kind).toBe('open')
      } finally {
        await supabase.from('courses').delete().eq('id', draft!.id)
      }
    })

    it("treats staff in sudo as the member they act as: only that member's courses", async () => {
      expect((await loadCourseList(createRepos(supabase), scope('none', false))).filter((i) => i.course.slug === SLUG)).toEqual([])
    })
  })

  describe('loadCourseView', () => {
    it('is null for an unknown slug', async () => {
      expect(await loadCourseView(createRepos(supabase), 'no-such-course', scope('current'))).toBeNull()
    })

    it('shows nothing of the course to someone without access', async () => {
      const view = await loadCourseView(createRepos(supabase), SLUG, scope('none'))
      expect(view).toMatchObject({ access: { kind: 'none' }, outline: null, progress: null })
      expect(view!.course.title).toBe(`Member Data ${ts}`)
    })

    it('gives the outline in order, with coming-soon lessons included', async () => {
      const view = await loadCourseView(createRepos(supabase), SLUG, scope('current'))
      expect(view!.outline!.lessons.map((l) => l.title)).toEqual(['A', 'Soon', 'B'])
      expect(view!.outline!.lessons.map((l) => l.state)).toEqual(['open', 'coming_soon', 'open'])
      expect([...view!.completed]).toEqual([ids.lessonA])
    })
  })

  describe('loadLessonView', () => {
    it('gives an open lesson with neighbours that skip coming soon, and its video', async () => {
      const result = await loadLessonView(createRepos(supabase), SLUG, ids.lessonA, scope('current'))
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
      const resumed = await loadLessonView(createRepos(supabase), SLUG, ids.lessonA, scope('current'))
      expect(resumed.kind === 'ok' && resumed.resumeSeconds).toBe(42.5)

      await supabase.from('lesson_progress').update({ last_position_seconds: 3 }).eq('member_id', ids.current).eq('lesson_id', ids.lessonA)
      const barely = await loadLessonView(createRepos(supabase), SLUG, ids.lessonA, scope('current'))
      expect(barely.kind === 'ok' && barely.resumeSeconds).toBe(0)

      const staff = await loadLessonView(createRepos(supabase), SLUG, ids.lessonA, scope('staff', true))
      expect(staff.kind === 'ok' && staff.resumeSeconds).toBe(0)
      await supabase.from('lesson_progress').update({ last_position_seconds: 0 }).eq('member_id', ids.current).eq('lesson_id', ids.lessonA)
    })

    it("gives the lesson's downloads in order, and none for a lesson without any", async () => {
      await supabase.from('course_lesson_files').insert([
        { lesson_id: ids.lessonA, source_key: `${SLUG}-f2`, filename: 'Second.pdf', storage_path: 'x/second', position: 2, size_bytes: 20 },
        { lesson_id: ids.lessonA, source_key: `${SLUG}-f1`, filename: 'First.pdf', storage_path: 'x/first', position: 1, size_bytes: 10 },
      ])
      const withFiles = await loadLessonView(createRepos(supabase), SLUG, ids.lessonA, scope('current'))
      expect(withFiles.kind === 'ok' && withFiles.files.map((f) => [f.filename, f.size_bytes])).toEqual([['First.pdf', 10], ['Second.pdf', 20]])
      // The storage path is never part of what the page gets.
      expect(withFiles.kind === 'ok' && withFiles.files[0]).not.toHaveProperty('storage_path')

      const without = await loadLessonView(createRepos(supabase), SLUG, ids.lessonB, scope('current'))
      expect(without.kind === 'ok' && without.files).toEqual([])
    })

    it('keeps a draft out of a member\'s outline and lessons, title included, and lets staff open it as a preview', async () => {
      const { data: sibling } = await supabase.from('course_lessons').select('module_id').eq('id', ids.lessonA).single()
      const { data: draft, error } = await supabase
        .from('course_lessons')
        .insert({ course_id: ids.course, module_id: sibling!.module_id, title: 'Secret draft', position: 9, state: 'hidden', body_html: '<p>not for members</p>', source_key: `${SLUG}-draft` })
        .select('id')
        .single()
      expect(error).toBeNull()
      try {
        // A member: not in the outline, not openable, not counted (and "not found", not "coming soon", so even the title isn't confirmed).
        const asMember = await loadCourseView(createRepos(supabase), SLUG, scope('current'))
        expect(asMember!.outline!.lessons.map((l) => l.title)).not.toContain('Secret draft')
        expect((await loadLessonView(createRepos(supabase), SLUG, draft!.id, scope('current'))).kind).toBe('not_found')
        const memberList = await loadCourseList(createRepos(supabase), scope('current'))
        expect(memberList.find((c) => c.course.slug === SLUG)!.progress.available).toBe(asMember!.progress!.available)

        // Staff acting as themselves: in the outline as hidden, openable as a preview, but not counted as available.
        const asStaff = await loadCourseView(createRepos(supabase), SLUG, scope('staff', true))
        expect(asStaff!.outline!.lessons.find((l) => l.title === 'Secret draft')).toMatchObject({ state: 'hidden' })
        expect(asStaff!.progress!.available).toBe(asMember!.progress!.available)
        const opened = await loadLessonView(createRepos(supabase), SLUG, draft!.id, scope('staff', true))
        expect(opened.kind).toBe('ok')
        if (opened.kind !== 'ok') return
        expect(opened.preview).toBe(true)
        expect(opened.lesson).toMatchObject({ title: 'Secret draft', state: 'hidden', body_html: '<p>not for members</p>' })
      } finally {
        await supabase.from('course_lessons').delete().eq('id', draft!.id)
      }
    })

    it('does not open a coming-soon lesson for a member, or for staff in sudo', async () => {
      expect((await loadLessonView(createRepos(supabase), SLUG, ids.lessonSoon, scope('current'))).kind).toBe('coming_soon')
      expect((await loadLessonView(createRepos(supabase), SLUG, ids.lessonSoon, scope('staff', false))).kind).toBe('no_access')
    })

    it('previews a coming-soon lesson for staff, stepping through unreleased lessons too', async () => {
      const result = await loadLessonView(createRepos(supabase), SLUG, ids.lessonSoon, scope('staff', true))
      expect(result.kind).toBe('ok')
      if (result.kind !== 'ok') return
      expect(result.preview).toBe(true)
      expect(result.neighbors.previous?.id).toBe(ids.lessonA)
      expect(result.neighbors.next?.id).toBe(ids.lessonB)
      // An open lesson is not a preview, and staff step through coming-soon ones from it.
      const open = await loadLessonView(createRepos(supabase), SLUG, ids.lessonA, scope('staff', true))
      expect(open.kind === 'ok' && open.preview).toBe(false)
      expect(open.kind === 'ok' && open.neighbors.next?.id).toBe(ids.lessonSoon)
    })

    it('does not open lessons once access ended, or without access', async () => {
      expect((await loadLessonView(createRepos(supabase), SLUG, ids.lessonA, scope('ended'))).kind).toBe('no_access')
      expect((await loadLessonView(createRepos(supabase), SLUG, ids.lessonA, scope('none'))).kind).toBe('no_access')
    })

    it('opens any lesson for staff, and answers not found for a lesson of another course or an unknown one', async () => {
      expect((await loadLessonView(createRepos(supabase), SLUG, ids.lessonA, scope('staff', true))).kind).toBe('ok')
      expect((await loadLessonView(createRepos(supabase), SLUG, '00000000-0000-4000-a000-000000000000', scope('current'))).kind).toBe('not_found')
      expect((await loadLessonView(createRepos(supabase), 'no-such-course', ids.lessonA, scope('current'))).kind).toBe('not_found')
    })
  })
})
