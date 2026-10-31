import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { ACCESS_OPTIONS, accessLabel } from '@/lib/courses/access-options'

/**
 * The course editor's create and edit actions against the real database. Who is calling is faked
 * (and the test client bypasses row-level security, which has its own pgTAP test,
 * supabase/tests/database/course_editor_writes.test.sql): what is tested here is the validation,
 * the program check, the unique address, and that only Hub-owned courses can be edited.
 */

const ts = Date.now()
const PREFIX = `test-editor-${ts}`

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

import { createCourse, updateCourseDetails } from '@/app/(admin)/admin/courses/actions'

const input = (over: Partial<Parameters<typeof createCourse>[0]> = {}) => ({
  title: `Editor ${ts}`,
  slug: `${PREFIX}-a`,
  description: '',
  accessChoice: '1',
  launchOn: '',
  programId: '',
  ...over,
})

describe('Course editor actions', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const rowBySlug = async (slug: string) => (await supabase.from('courses').select('*').eq('slug', slug).maybeSingle()).data

  beforeAll(async () => {
    const { data: program } = await supabase.from('programs').insert({ name: `Editor program ${ts}`, slug: `${PREFIX}-program`, kajabi_offer_names: [] }).select('id').single()
    ids.program = program!.id
    const { data: kajabi } = await supabase.from('courses').insert({ slug: `${PREFIX}-kajabi`, title: 'Imported', source: 'kajabi', source_key: `${PREFIX}-kajabi` }).select('id').single()
    ids.kajabi = kajabi!.id
  })
  beforeEach(() => {
    auth.admin = true
    revalidatePath.mockClear()
  })
  afterAll(async () => {
    await supabase.from('courses').delete().like('slug', `${PREFIX}%`)
    await supabase.from('programs').delete().eq('id', ids.program)
  })

  describe('createCourse', () => {
    it('creates a Hub-owned, evergreen course with the details as stored, and gives its id', async () => {
      const result = await createCourse(input({ description: ' Learn to write. ', accessChoice: '0', launchOn: '2026-12-01', programId: ids.program }))
      expect(result.id).toMatch(/^crs_/)
      expect(await rowBySlug(`${PREFIX}-a`)).toMatchObject({
        id: result.id,
        title: `Editor ${ts}`,
        description: 'Learn to write.',
        source: 'hub',
        source_key: null,
        kind: 'evergreen',
        access_duration: null,
        launch_at: '2026-12-01T05:00:00+00:00',
        program_id: ids.program,
      })
      expect(revalidatePath).toHaveBeenCalledWith('/admin/courses')
      expect(revalidatePath).toHaveBeenCalledWith('/courses', 'layout')
    })

    it("derives the address from the name when none is given, and stores the chosen access length", async () => {
      const result = await createCourse(input({ title: `${PREFIX} Derived`, slug: '', accessChoice: '2' }))
      const row = await rowBySlug(`${PREFIX}-derived`)
      expect(row).toMatchObject({ id: result.id, slug: `${PREFIX}-derived` })
      // The interval comes back as ISO or Postgres text depending on the connection; it reads the same.
      expect(accessLabel(row!.access_duration)).toBe(ACCESS_OPTIONS[2].label)
    })

    it('returns every field problem and writes nothing', async () => {
      const result = await createCourse(input({ title: '', accessChoice: '', slug: 'Bad Slug', programId: 'nope' }))
      expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['accessChoice', 'programId', 'slug', 'title'])
      expect(result.id).toBeUndefined()
      expect(await rowBySlug('Bad Slug')).toBeNull()
    })

    it("refuses a program that doesn't exist", async () => {
      const result = await createCourse(input({ slug: `${PREFIX}-noprogram`, programId: 'prg_AAAAAAAAAAA1' }))
      expect(result.fieldErrors).toEqual({ programId: "That program doesn't exist." })
      expect(await rowBySlug(`${PREFIX}-noprogram`)).toBeNull()
    })

    it('says so when another course already has the address (a Kajabi course counts)', async () => {
      expect((await createCourse(input({ slug: `${PREFIX}-kajabi` }))).fieldErrors).toEqual({ slug: 'Another course already uses that address.' })
      await createCourse(input({ slug: `${PREFIX}-twice` }))
      expect((await createCourse(input({ slug: `${PREFIX}-twice` }))).fieldErrors).toEqual({ slug: 'Another course already uses that address.' })
    })

    it("does nothing for someone who isn't an admin", async () => {
      auth.admin = false
      expect(await createCourse(input({ slug: `${PREFIX}-denied` }))).toEqual({ error: 'Not authorized' })
      expect(await rowBySlug(`${PREFIX}-denied`)).toBeNull()
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })

  describe('updateCourseDetails', () => {
    let courseId: string
    beforeAll(async () => {
      auth.admin = true // the tests before this block end as someone who isn't an admin
      courseId = (await createCourse(input({ slug: `${PREFIX}-edit`, title: 'Before' }))).id!
    })

    it('saves the new details to that course and refreshes its pages', async () => {
      const result = await updateCourseDetails(courseId, input({ slug: `${PREFIX}-edit`, title: 'After', accessChoice: '3', launchOn: '2026-07-01' }))
      expect(result).toEqual({ id: courseId })
      expect(await rowBySlug(`${PREFIX}-edit`)).toMatchObject({ title: 'After', launch_at: '2026-07-01T04:00:00+00:00' })
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${courseId}`)
    })

    it('can clear the opening day and the program', async () => {
      await updateCourseDetails(courseId, input({ slug: `${PREFIX}-edit`, launchOn: '2026-07-01', programId: ids.program }))
      await updateCourseDetails(courseId, input({ slug: `${PREFIX}-edit`, launchOn: '', programId: '' }))
      expect(await rowBySlug(`${PREFIX}-edit`)).toMatchObject({ launch_at: null, program_id: null })
    })

    it('refuses an address another course has, leaving the course as it was', async () => {
      const result = await updateCourseDetails(courseId, input({ slug: `${PREFIX}-kajabi`, title: 'Changed anyway' }))
      expect(result.fieldErrors).toEqual({ slug: 'Another course already uses that address.' })
      expect((await rowBySlug(`${PREFIX}-edit`))!.title).not.toBe('Changed anyway')
    })

    it('returns the field problems and writes nothing', async () => {
      const result = await updateCourseDetails(courseId, input({ slug: `${PREFIX}-edit`, title: '' }))
      expect(result.fieldErrors?.title).toBeDefined()
      expect((await rowBySlug(`${PREFIX}-edit`))!.title).not.toBe('')
    })

    it("won't edit a course imported from Kajabi, even by its id", async () => {
      const result = await updateCourseDetails(ids.kajabi, input({ slug: `${PREFIX}-kajabi`, title: 'Hijacked' }))
      expect(result.error).toMatch(/can't be edited here/)
      expect((await rowBySlug(`${PREFIX}-kajabi`))!.title).toBe('Imported')
    })

    it('says so for an id that is not a course, or a course that is gone', async () => {
      expect(await updateCourseDetails('not-an-id', input())).toEqual({ error: 'Course not found.' })
      expect((await updateCourseDetails('crs_AAAAAAAAAAA1', input({ slug: `${PREFIX}-ghost` }))).error).toMatch(/can't be edited here/)
    })

    it("does nothing for someone who isn't an admin", async () => {
      auth.admin = false
      expect(await updateCourseDetails(courseId, input({ slug: `${PREFIX}-edit`, title: 'Denied' }))).toEqual({ error: 'Not authorized' })
      expect((await rowBySlug(`${PREFIX}-edit`))!.title).not.toBe('Denied')
    })
  })
})
