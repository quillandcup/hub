import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * The course editor's outline actions (add, rename, delete, duplicate, reorder) against the real
 * database. Who is calling is faked, and the test client bypasses row-level security, which has its own
 * pgTAP test (supabase/tests/database/course_editor_outline.test.sql): what is tested here is the
 * validation, positions, the progress guard on deleting, and what the database functions return.
 */

const ts = Date.now()
const PREFIX = `test-outline-${ts}`

const auth = vi.hoisted(() => ({ admin: true, client: null as unknown }))
vi.mock('@/lib/admin-auth', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return {
    requireAdminAction: async () => (auth.admin ? { ok: true, user: { id: 'user-admin', email: 'admin@example.test' }, supabase: auth.client ?? getTestSupabaseAdminClient() } : { ok: false, error: 'Not authorized' }),
  }
})
// The outcome is recorded against the current visit, which a test doesn't have.
vi.mock('@/lib/analytics/server', () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))

import { addCourseLesson, addCourseModule, deleteCourseItem, duplicateCourseItem, renameCourseItem, reorderCourseItems, saveLessonText, setCourseItemStatus } from '@/app/(admin)/admin/courses/outline-actions'

describe('Course outline actions', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const moduleRow = async (id: string) => (await supabase.from('course_modules').select('*').eq('id', id).maybeSingle()).data
  const lesson = async (id: string) => (await supabase.from('course_lessons').select('*').eq('id', id).maybeSingle()).data
  const titlesIn = async (moduleId: string) => ((await supabase.from('course_lessons').select('title').eq('module_id', moduleId).order('position')).data ?? []).map((l) => l.title)

  beforeAll(async () => {
    const mk = async (slug: string, source: 'hub' | 'kajabi') =>
      (await supabase.from('courses').insert({ slug: `${PREFIX}-${slug}`, title: slug, source, source_key: source === 'kajabi' ? `${PREFIX}-${slug}` : null }).select('id').single()).data!.id
    ids.course = await mk('hub', 'hub')
    ids.other = await mk('other', 'hub')
    ids.kajabi = await mk('kajabi', 'kajabi')
    const { data: kajabiModule } = await supabase.from('course_modules').insert({ course_id: ids.kajabi, title: 'Imported', source: 'kajabi', source_key: `${PREFIX}-m` }).select('id').single()
    ids.kajabiModule = kajabiModule!.id
    const { data: otherModule } = await supabase.from('course_modules').insert({ course_id: ids.other, title: 'Other', source: 'hub', state: 'hidden' }).select('id').single()
    ids.otherModule = otherModule!.id
    const { data: member } = await supabase.from('members').insert({ name: 'Outline Member', email: `outline-${ts}@example.com`, joined_at: new Date().toISOString(), status: 'active' }).select('id').single()
    ids.member = member!.id
  })
  beforeEach(() => {
    auth.admin = true
    revalidatePath.mockClear()
  })
  afterAll(async () => {
    await supabase.from('courses').delete().like('slug', `${PREFIX}%`) // modules and lessons go with it
    await supabase.from('members').delete().eq('id', ids.member)
  })

  describe('addCourseModule and addCourseLesson', () => {
    it('adds modules at the end, as Hub-owned drafts, and refreshes the pages', async () => {
      const first = await addCourseModule(ids.course, null, '  Module 1  ')
      const second = await addCourseModule(ids.course, null, 'Module 2')
      expect(first.id).toMatch(/^mod_/)
      expect(await moduleRow(first.id!)).toMatchObject({ title: 'Module 1', position: 1, state: 'hidden', publishing_option: 'draft', source: 'hub', source_key: null, parent_id: null, course_id: ids.course })
      expect(await moduleRow(second.id!)).toMatchObject({ position: 2 })
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.course}`)
      expect(revalidatePath).toHaveBeenCalledWith('/courses', 'layout')
      ids.m1 = first.id!
      ids.m2 = second.id!
    })

    it('adds a submodule inside a module, numbered among its own siblings, and refuses a third level', async () => {
      const week1 = await addCourseModule(ids.course, ids.m1, 'Week 1')
      const week2 = await addCourseModule(ids.course, ids.m1, 'Week 2')
      expect(await moduleRow(week1.id!)).toMatchObject({ parent_id: ids.m1, position: 1, state: 'hidden' })
      expect(await moduleRow(week2.id!)).toMatchObject({ position: 2 })
      expect(await addCourseModule(ids.course, week1.id!, 'Too deep')).toEqual({ error: "A submodule can't have submodules" })
      ids.week1 = week1.id!
      ids.week2 = week2.id!
    })

    it('adds lessons at the end of a module, as Hub-owned draft lessons', async () => {
      const a = await addCourseLesson(ids.course, ids.week1, 'Lesson A')
      const b = await addCourseLesson(ids.course, ids.week1, 'Lesson B')
      expect(a.id).toMatch(/^les_/)
      expect(await lesson(a.id!)).toMatchObject({ title: 'Lesson A', position: 1, state: 'hidden', source: 'hub', module_id: ids.week1, course_id: ids.course })
      expect(await lesson(b.id!)).toMatchObject({ position: 2 })
      ids.a = a.id!
      ids.b = b.id!
    })

    it("refuses a module of another course, with a reason, and writes nothing", async () => {
      expect(await addCourseModule(ids.course, ids.otherModule, 'Crossing')).toEqual({ error: "That doesn't fit there." })
      expect(await addCourseLesson(ids.course, ids.otherModule, 'Crossing')).toEqual({ error: "That doesn't fit there." })
      expect((await supabase.from('course_lessons').select('id').eq('title', 'Crossing')).data).toEqual([])
    })

    it('needs a name of a sensible length, and ids that are ids', async () => {
      expect(await addCourseModule(ids.course, null, '   ')).toEqual({ error: 'Give it a name.' })
      expect((await addCourseModule(ids.course, null, 'x'.repeat(121))).error).toMatch(/under 120/)
      expect(await addCourseModule('nope', null, 'Name')).toEqual({ error: 'Course not found.' })
      expect(await addCourseModule(ids.course, 'nope', 'Name')).toEqual({ error: 'Course not found.' })
      expect(await addCourseLesson(ids.course, 'nope', 'Name')).toEqual({ error: 'Course not found.' })
    })

    it("does nothing for someone who isn't an admin", async () => {
      auth.admin = false
      expect(await addCourseModule(ids.course, null, 'Denied')).toEqual({ error: 'Not authorized' })
      expect(await addCourseLesson(ids.course, ids.week1, 'Denied')).toEqual({ error: 'Not authorized' })
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })

  describe('saveLessonText', () => {
    const stored = async (id: string) => (await supabase.from('course_lessons').select('body_html, excerpt').eq('id', id).single()).data!

    it('stores the text cleaned to the lesson allowlist, with its teaser, and refreshes the pages', async () => {
      const result = await saveLessonText(ids.course, ids.a, '<h2>Welcome</h2><p onclick="x()">Hello <b>Hedgies</b><script>alert(1)</script></p><a href="javascript:alert(1)">bad</a>')
      expect(result).toEqual({ id: ids.a })
      const row = await stored(ids.a)
      expect(row.body_html).toContain('<h2>Welcome</h2>')
      expect(row.body_html).not.toMatch(/script|onclick|javascript:/)
      expect(row.excerpt).toBe('Welcome Hello Hedgies bad')
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.course}`)
      expect(revalidatePath).toHaveBeenCalledWith('/courses', 'layout')
    })

    it('drops the empty paragraph the editor leaves at the end', async () => {
      await saveLessonText(ids.course, ids.a, '<ol><li><p>One</p></li></ol><p></p>')
      expect((await stored(ids.a)).body_html).toBe('<ol><li><p>One</p></li></ol>')
    })

    it('clears the text when it is empty', async () => {
      await saveLessonText(ids.course, ids.a, '<p>Something</p>')
      expect(await saveLessonText(ids.course, ids.a, '<p> </p>')).toEqual({ id: ids.a })
      expect(await stored(ids.a)).toEqual({ body_html: null, excerpt: null })
    })

    it('records the change in the audit log for that lesson', async () => {
      await saveLessonText(ids.course, ids.a, '<p>Audited text</p>')
      const { data } = await supabase.from('audit_log').select('changes').eq('entity_type', 'course_lesson').eq('entity_id', ids.a).eq('action', 'update')
      expect(JSON.stringify(data)).toContain('Audited text')
    })

    it("won't write the text of another course's lesson, an imported course's, or a missing one's, and refuses a bad id or too long a text", async () => {
      expect((await saveLessonText(ids.other, ids.a, '<p>x</p>')).error).toMatch(/can't be edited here/)
      expect((await saveLessonText(ids.kajabi, ids.a, '<p>x</p>')).error).toMatch(/can't be edited here/)
      expect((await saveLessonText(ids.course, 'les_AAAAAAAAAAA1', '<p>x</p>')).error).toMatch(/can't be edited here/)
      expect(await saveLessonText('nope', ids.a, '<p>x</p>')).toEqual({ error: 'Not found.' })
      expect(await saveLessonText(ids.course, ids.m1, '<p>x</p>')).toEqual({ error: 'Not found.' })
      expect(await saveLessonText(ids.course, ids.a, 'x'.repeat(200_001))).toEqual({ error: 'That text is too long.' })
    })

    it('says so when the database refuses the write, and changes nothing', async () => {
      await saveLessonText(ids.course, ids.a, '<p>Before</p>')
      auth.client = { from: () => { throw new Error('connection lost') } }
      try {
        const result = await saveLessonText(ids.course, ids.a, '<p>After</p>')
        expect(result.error).toMatch(/save the text/)
        expect(result.id).toBeUndefined()
      } finally {
        auth.client = null
      }
      expect((await stored(ids.a)).body_html).toBe('<p>Before</p>')
    })

    it("does nothing for someone who isn't an admin", async () => {
      auth.admin = false
      expect(await saveLessonText(ids.course, ids.a, '<p>Denied</p>')).toEqual({ error: 'Not authorized' })
      auth.admin = true
      expect((await stored(ids.a)).body_html ?? '').not.toContain('Denied')
    })
  })

  describe('renameCourseItem', () => {
    it('renames a module and a lesson, trimmed', async () => {
      expect(await renameCourseItem(ids.course, 'module', ids.m2, '  Renamed module ')).toEqual({ id: ids.m2 })
      expect(await renameCourseItem(ids.course, 'lesson', ids.a, 'Renamed lesson')).toEqual({ id: ids.a })
      expect((await moduleRow(ids.m2))!.title).toBe('Renamed module')
      expect((await lesson(ids.a))!.title).toBe('Renamed lesson')
    })

    it("won't rename into nothing, or an item of another course or one imported from Kajabi", async () => {
      expect(await renameCourseItem(ids.course, 'lesson', ids.a, ' ')).toEqual({ error: 'Give it a name.' })
      expect((await renameCourseItem(ids.other, 'lesson', ids.a, 'Hijack')).error).toMatch(/can't be edited here/)
      expect((await renameCourseItem(ids.kajabi, 'module', ids.kajabiModule, 'Hijack')).error).toMatch(/can't be edited here/)
      expect((await moduleRow(ids.kajabiModule))!.title).toBe('Imported')
      expect((await lesson(ids.a))!.title).toBe('Renamed lesson')
    })

    it('refuses a wrong kind or an id that is not one', async () => {
      expect(await renameCourseItem(ids.course, 'lesson', ids.m1, 'Name')).toEqual({ error: 'Not found.' })
      expect(await renameCourseItem(ids.course, 'module', ids.a, 'Name')).toEqual({ error: 'Not found.' })
      expect(await renameCourseItem(ids.course, 'chapter' as never, ids.a, 'Name')).toEqual({ error: 'Not found.' })
    })
  })

  describe('reorderCourseItems', () => {
    it('puts lessons in the given order, and says so for modules too', async () => {
      expect(await reorderCourseItems(ids.course, 'lesson', ids.week1, [ids.b, ids.a])).toEqual({ id: ids.course })
      expect(await titlesIn(ids.week1)).toEqual(['Lesson B', 'Renamed lesson'])
      expect(await reorderCourseItems(ids.course, 'module', null, [ids.m2, ids.m1])).toEqual({ id: ids.course })
      expect(((await supabase.from('course_modules').select('id').eq('course_id', ids.course).is('parent_id', null).order('position')).data ?? []).map((m) => m.id)).toEqual([ids.m2, ids.m1])
      expect(await reorderCourseItems(ids.course, 'module', ids.m1, [ids.week2, ids.week1])).toEqual({ id: ids.course })
    })

    it('refuses a list that is not exactly the current children, as out of date', async () => {
      const stale = 'The outline changed since you opened it. Refresh the page and try again.'
      expect(await reorderCourseItems(ids.course, 'lesson', ids.week1, [ids.a])).toEqual({ error: stale })
      expect(await reorderCourseItems(ids.course, 'lesson', ids.week1, [ids.a, ids.a, ids.b])).toEqual({ error: stale })
      expect(await titlesIn(ids.week1)).toEqual(['Lesson B', 'Renamed lesson'])
    })

    it('refuses a bad id, an empty or oversized list, and a wrong kind', async () => {
      expect(await reorderCourseItems(ids.course, 'lesson', ids.week1, [])).toEqual({ error: 'Not found.' })
      expect(await reorderCourseItems(ids.course, 'lesson', ids.week1, ['nope'])).toEqual({ error: 'Not found.' })
      expect(await reorderCourseItems(ids.course, 'lesson', ids.week1, [ids.m1])).toEqual({ error: 'Not found.' })
      expect(await reorderCourseItems(ids.course, 'lesson', 'nope', [ids.a])).toEqual({ error: 'Not found.' })
      expect(await reorderCourseItems('nope', 'lesson', ids.week1, [ids.a])).toEqual({ error: 'Not found.' })
      expect(await reorderCourseItems(ids.course, 'lesson', ids.week1, Array.from({ length: 501 }, () => ids.a))).toEqual({ error: 'Not found.' })
    })

    it("does nothing for someone who isn't an admin", async () => {
      auth.admin = false
      expect(await reorderCourseItems(ids.course, 'lesson', ids.week1, [ids.a, ids.b])).toEqual({ error: 'Not authorized' })
    })
  })

  describe('duplicateCourseItem', () => {
    it('copies a lesson to the end of its module, hidden, named as a copy', async () => {
      const result = await duplicateCourseItem(ids.course, 'lesson', ids.a)
      expect(result.id).toMatch(/^les_/)
      expect(await lesson(result.id!)).toMatchObject({ title: 'Renamed lesson (copy)', state: 'hidden', source: 'hub', module_id: ids.week1, position: 3 })
    })

    it('copies a module with its submodules and their lessons, hidden', async () => {
      const result = await duplicateCourseItem(ids.course, 'module', ids.m1)
      expect(result.id).toMatch(/^mod_/)
      expect(await moduleRow(result.id!)).toMatchObject({ title: 'Module 1 (copy)', state: 'hidden', source: 'hub', parent_id: null })
      const { data: weeks } = await supabase.from('course_modules').select('id, title, state').eq('parent_id', result.id!).order('position')
      expect((weeks ?? []).map((w) => `${w.title}:${w.state}`)).toEqual(['Week 2:hidden', 'Week 1:hidden'])
      const copied = (weeks ?? []).find((w) => w.title === 'Week 1')!
      expect((await titlesIn(copied.id)).sort()).toEqual(['Lesson B', 'Renamed lesson', 'Renamed lesson (copy)'])
    })

    it('says so for an item that is gone, and refuses a bad id', async () => {
      expect(await duplicateCourseItem(ids.course, 'lesson', 'les_AAAAAAAAAAA1')).toEqual({ error: 'That has been deleted. Refresh the page.' })
      expect(await duplicateCourseItem(ids.course, 'lesson', ids.m1)).toEqual({ error: 'Not found.' })
    })

    it("does nothing for someone who isn't an admin", async () => {
      auth.admin = false
      expect(await duplicateCourseItem(ids.course, 'lesson', ids.a)).toEqual({ error: 'Not authorized' })
    })
  })

  describe('deleteCourseItem', () => {
    it('deletes a lesson', async () => {
      const added = await addCourseLesson(ids.course, ids.week2, 'Gone soon')
      expect(await deleteCourseItem(ids.course, 'lesson', added.id!)).toEqual({ id: added.id })
      expect(await lesson(added.id!)).toBeNull()
    })

    it('deletes a module together with its submodules and lessons', async () => {
      const added = await addCourseModule(ids.course, null, 'Doomed')
      const sub = await addCourseModule(ids.course, added.id!, 'Doomed week')
      const les = await addCourseLesson(ids.course, sub.id!, 'Doomed lesson')
      expect(await deleteCourseItem(ids.course, 'module', added.id!)).toEqual({ id: added.id })
      expect(await moduleRow(sub.id!)).toBeNull()
      expect(await lesson(les.id!)).toBeNull()
    })

    it("won't delete a lesson, or a module holding one, that a member has progress in", async () => {
      const mod = await addCourseModule(ids.course, null, 'Worked through')
      const sub = await addCourseModule(ids.course, mod.id!, 'Worked through week')
      const les = await addCourseLesson(ids.course, sub.id!, 'Worked through lesson')
      await supabase.from('lesson_progress').insert({ member_id: ids.member, lesson_id: les.id!, last_position_seconds: 5 })

      expect((await deleteCourseItem(ids.course, 'lesson', les.id!)).error).toBe('Members have progress in this lesson, so it can\'t be deleted. Hide it instead.')
      expect((await deleteCourseItem(ids.course, 'module', mod.id!)).error).toBe("Members have progress in its lessons, so it can't be deleted. Hide it instead.")
      expect(await lesson(les.id!)).not.toBeNull()
      expect(await moduleRow(sub.id!)).not.toBeNull()
    })

    it("won't delete an item of another course or one imported from Kajabi", async () => {
      expect((await deleteCourseItem(ids.course, 'module', ids.otherModule)).error).toMatch(/can't be edited here/)
      expect((await deleteCourseItem(ids.kajabi, 'module', ids.kajabiModule)).error).toMatch(/can't be edited here/)
      expect(await moduleRow(ids.otherModule)).not.toBeNull()
      expect(await moduleRow(ids.kajabiModule)).not.toBeNull()
    })

    it("does nothing for someone who isn't an admin, and refuses a bad id", async () => {
      expect(await deleteCourseItem(ids.course, 'lesson', 'nope')).toEqual({ error: 'Not found.' })
      auth.admin = false
      expect(await deleteCourseItem(ids.course, 'lesson', ids.a)).toEqual({ error: 'Not authorized' })
      expect(await lesson(ids.a)).not.toBeNull()
    })
  })

  describe('setCourseItemStatus', () => {
    let course: string
    let top: string
    let week: string
    let lesson: string
    const states = async () => {
      const mods = (await supabase.from('course_modules').select('title, state').eq('course_id', course)).data ?? []
      const les = (await supabase.from('course_lessons').select('title, state').eq('course_id', course)).data ?? []
      return Object.fromEntries([...mods, ...les].map((r) => [r.title, r.state]))
    }

    beforeAll(async () => {
      auth.admin = true
      course = (await supabase.from('courses').insert({ slug: `${PREFIX}-status`, title: 'Status', source: 'hub' }).select('id').single()).data!.id
      top = (await addCourseModule(course, null, 'Top')).id!
      week = (await addCourseModule(course, top, 'Week')).id!
      lesson = (await addCourseLesson(course, week, 'Lesson')).id!
    })

    it('starts everything as a draft, hidden', async () => {
      expect(await states()).toEqual({ Top: 'hidden', Week: 'hidden', Lesson: 'hidden' })
    })

    it("sets one item's own setting, and what is under it is limited by it", async () => {
      await setCourseItemStatus(course, 'module', week, 'published')
      await setCourseItemStatus(course, 'lesson', lesson, 'published')
      expect(await setCourseItemStatus(course, 'module', top, 'published')).toEqual({ id: top })
      expect(await states()).toEqual({ Top: 'open', Week: 'open', Lesson: 'open' })
      expect((await supabase.from('course_modules').select('publishing_option').eq('id', top).single()).data!.publishing_option).toBe('published')
      expect(await setCourseItemStatus(course, 'module', top, 'draft')).toEqual({ id: top })
      expect(await states()).toEqual({ Top: 'hidden', Week: 'hidden', Lesson: 'hidden' })
    })

    it("lets everything in a section be marked published while the section is a draft, then switches it all on with the section's own setting", async () => {
      await setCourseItemStatus(course, 'module', top, 'draft')
      expect(await setCourseItemStatus(course, 'module', week, 'published')).toEqual({ id: week })
      expect(await setCourseItemStatus(course, 'lesson', lesson, 'published')).toEqual({ id: lesson })
      expect(await states()).toEqual({ Top: 'hidden', Week: 'hidden', Lesson: 'hidden' })
      await setCourseItemStatus(course, 'module', top, 'published')
      expect(await states()).toEqual({ Top: 'open', Week: 'open', Lesson: 'open' })
      await setCourseItemStatus(course, 'module', top, 'draft')
      expect(await states()).toEqual({ Top: 'hidden', Week: 'hidden', Lesson: 'hidden' })
      await setCourseItemStatus(course, 'module', top, 'published')
    })

    it("doesn't offer scheduled or drip yet, for an item", async () => {
      const unavailable = { error: "That setting isn't available yet." }
      expect(await setCourseItemStatus(course, 'lesson', lesson, 'drip')).toEqual(unavailable)
      expect(await setCourseItemStatus(course, 'lesson', lesson, 'scheduled')).toEqual(unavailable)
    })

    it('says so for an item that is gone, and refuses ids that are not ids', async () => {
      expect(await setCourseItemStatus(course, 'lesson', 'les_AAAAAAAAAAA1', 'draft')).toEqual({ error: 'That has been deleted. Refresh the page.' })
      expect(await setCourseItemStatus(course, 'lesson', top, 'draft')).toEqual({ error: 'Not found.' })
      expect(await setCourseItemStatus('nope', 'lesson', lesson, 'draft')).toEqual({ error: 'Not found.' })
    })

    it("won't change what is in a course imported from Kajabi", async () => {
      expect((await setCourseItemStatus(ids.kajabi, 'module', ids.kajabiModule, 'draft')).error).toMatch(/can't be edited here/)
      expect((await supabase.from('course_modules').select('publishing_option').eq('id', ids.kajabiModule).single()).data!.publishing_option).not.toBe('draft')
    })

    it("does nothing for someone who isn't an admin", async () => {
      auth.admin = false
      expect(await setCourseItemStatus(course, 'module', top, 'draft')).toEqual({ error: 'Not authorized' })
      auth.admin = true
      expect(await states()).toEqual({ Top: 'open', Week: 'open', Lesson: 'open' })
    })
  })
})
