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

const auth = vi.hoisted(() => ({ admin: true }))
vi.mock('@/lib/admin-auth', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return {
    requireAdminAction: async () => (auth.admin ? { ok: true, user: { id: 'user-admin', email: 'admin@example.test' }, supabase: getTestSupabaseAdminClient() } : { ok: false, error: 'Not authorized' }),
  }
})
// The outcome is recorded against the current visit, which a test doesn't have.
vi.mock('@/lib/analytics/server', () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))

import { addCourseLesson, addCourseModule, deleteCourseItem, duplicateCourseItem, renameCourseItem, reorderCourseItems } from '@/app/(admin)/admin/courses/outline-actions'

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
      expect(await moduleRow(first.id!)).toMatchObject({ title: 'Module 1', position: 1, state: 'hidden', source: 'hub', source_key: null, parent_id: null, course_id: ids.course })
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

    it('adds lessons at the end of a module, as hidden Hub-owned lessons', async () => {
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
})
