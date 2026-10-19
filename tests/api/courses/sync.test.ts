import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { syncKajabiCourses } from '@/lib/courses/sync'
import { processCourses } from '@/lib/courses/process'

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

  const mine = <T extends { slug?: string; id?: string }>(rows: T[] | undefined) => (rows ?? []).filter((r) => r.slug === SLUG || r.id === COURSE)

  it('imports a new course but leaves it unpublished, naming the slug publishing would use', async () => {
    const result = await syncKajabiCourses(supabase, kajabi)

    expect(result.error).toBeUndefined()
    expect(result.imported?.courses.find((c) => c.id === COURSE)).toMatchObject({ title: TITLE, lessons: 1 })
    expect(result.unpublished?.find((c) => c.id === COURSE)).toEqual({ id: COURSE, title: TITLE, slug: SLUG })
    expect(mine(result.processed)).toEqual([])
    expect((await supabase.from('courses').select('id').eq('source_key', COURSE)).data).toEqual([])
  })

  it('refreshes a course once it is published, and stops listing it as unpublished', async () => {
    await processCourses(supabase, { courseSlug: SLUG, accessDuration: '1 year' })
    state.lessonTitle = 'One, renamed'
    const result = await syncKajabiCourses(supabase, kajabi)

    expect(result.unpublished?.find((c) => c.id === COURSE)).toBeUndefined()
    expect(mine(result.processed)).toHaveLength(1)
    const course = (await supabase.from('courses').select('id').eq('source_key', COURSE).single()).data!
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
