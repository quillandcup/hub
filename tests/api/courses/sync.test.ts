import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { syncKajabiCourses } from '@/lib/courses/sync'
import { processCourses } from '@/lib/courses/process'
import { createRepos } from "@/lib/data/repos";

/**
 * The course half of the standard Kajabi sync: import structure, refresh published courses, list
 * the unpublished ones, and never throw. Real local database, fake Kajabi.
 */

const ts = Date.now()
const COURSE = `test-sync-${ts}`
const TITLE = `Sync Course ${ts}`
const SLUG = `sync-course-${ts}`

const state = { fail: false, lessonTitle: 'One' }
const kajabi = {
  fetchAllCourses: async () => {
    if (state.fail) throw new Error('Kajabi API error (500)')
    return [{ id: COURSE, type: 'courses', attributes: {} }]
  },
  fetchCourse: async () => ({
    data: { id: COURSE, type: 'courses', attributes: { title: TITLE, description: 'd' } },
    included: [{ id: `${COURSE}-l`, type: 'lessons', attributes: { title: state.lessonTitle, position: 1, publishing_option: 'published' }, relationships: {} }],
  }),
}

describe('syncKajabiCourses', () => {
  const supabase = getTestSupabaseAdminClient()

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE)
    await supabase.schema('bronze').from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await supabase.schema('bronze').from('kajabi_courses').delete().eq('kajabi_id', COURSE)
  }
  beforeAll(cleanup)
  afterAll(cleanup)
  beforeEach(() => {
    state.fail = false
  })

  let draftId = ''
  const mine = <T extends { slug?: string; id?: string }>(rows: T[] | undefined) => (rows ?? []).filter((r) => r.slug === SLUG || r.id === COURSE)

  it('imports a new course but leaves it unpublished, naming the slug publishing would use', async () => {
    const result = await syncKajabiCourses(supabase, kajabi)

    expect(result.error).toBeUndefined()
    expect(result.imported?.courses.find((c) => c.id === COURSE)).toMatchObject({ title: TITLE, lessons: 1 })
    expect(result.unpublished?.find((c) => c.id === COURSE)).toEqual({ id: COURSE, title: TITLE, slug: SLUG })
    // Its content is synced too, so staff can build and preview it, but it is a draft with no access.
    expect(mine(result.processed)).toMatchObject([{ slug: SLUG, lessons: 1, access: { members: 0, removed: 0 } }])
    const draft = (await supabase.from('courses').select('id, slug, is_draft').eq('source_key', COURSE)).data!
    expect(draft).toEqual([{ id: expect.stringMatching(/^crs_/), slug: SLUG, is_draft: true }])
    expect((await supabase.from('course_lessons').select('title').eq('course_id', draft[0].id)).data).toEqual([{ title: 'One' }])
    draftId = draft[0].id
  })

  it('refreshes a course once it is published, and stops listing it as unpublished', async () => {
    await processCourses(createRepos(supabase), { courseSlug: SLUG, publish: true, accessDuration: '1 year' })
    state.lessonTitle = 'One, renamed'
    const result = await syncKajabiCourses(supabase, kajabi)

    expect(result.unpublished?.find((c) => c.id === COURSE)).toBeUndefined()
    expect(mine(result.processed)).toHaveLength(1)
    const course = (await supabase.from('courses').select('id, is_draft').eq('source_key', COURSE).single()).data!
    // Publishing keeps the draft's id and clears the flag.
    expect(course).toEqual({ id: draftId, is_draft: false })
    const lessons = (await supabase.from('course_lessons').select('title').eq('course_id', course.id)).data
    expect(lessons).toEqual([{ title: 'One, renamed' }])
  })

  it('reports a failure instead of throwing, so it cannot fail the member sync it rides on', async () => {
    state.fail = true
    const result = await syncKajabiCourses(supabase, kajabi)

    expect(result.error).toBe('Kajabi API error (500)')
    expect(result.imported).toBeUndefined()
  })
})
