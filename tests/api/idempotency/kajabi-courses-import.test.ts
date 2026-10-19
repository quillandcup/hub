import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/import/kajabi-courses is idempotent (Bronze pattern: UPSERT on Kajabi ids, soft-delete
 * what a complete fetch no longer returns):
 * 1. First import creates the course, modules, lessons and offers
 * 2. Re-importing the same data creates no duplicates and leaves step B's content columns alone
 * 3. A changed lesson updates; a removed lesson is soft-deleted and comes back undeleted
 * 4. A failed Kajabi call writes and soft-deletes nothing
 *
 * Kajabi is faked; the database is the real local one. Every call passes `courseIds`, so the run
 * never touches (or soft-deletes) any other course in the shared local database.
 */

const ts = Date.now()
const COURSE = `test-kc-${ts}`
const M1 = `${COURSE}-m1`
const L1 = `${COURSE}-l1`
const L2 = `${COURSE}-l2`
const OFFER = `${COURSE}-offer`

const fake = vi.hoisted(() => ({
  response: null as any,
  fail: false,
}))

vi.mock('@/lib/kajabi/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kajabi/client')>()),
  createKajabiClient: () => ({
    fetchAllCourses: async () => [{ id: fake.response.data.id, type: 'courses', attributes: {} }],
    fetchCourse: async () => {
      if (fake.fail) throw new Error('Kajabi API error (500)')
      return fake.response
    },
  }),
}))

function courseResponse(lessons: { id: string; title: string }[]) {
  return {
    data: { id: COURSE, type: 'courses', attributes: { title: `Test Course ${ts}`, description: 'd' } },
    included: [
      { id: M1, type: 'modules', attributes: { title: 'Module', position: 1, publishing_option: 'published' }, relationships: {} },
      ...lessons.map((l, i) => ({
        id: l.id,
        type: 'lessons',
        attributes: { title: l.title, position: i + 1, publishing_option: 'published' },
        relationships: { module: { data: { id: M1, type: 'modules' } } },
      })),
      { id: OFFER, type: 'offers', attributes: { name: 'Test Offer' }, relationships: {} },
    ],
  }
}

describe('Kajabi courses import idempotency', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')

  async function importCourse() {
    return apiFetch(`${getTestApiBaseUrl()}/api/import/kajabi-courses`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseIds: [COURSE] }),
    })
  }

  async function cleanup() {
    await bronze.from('kajabi_course_offers').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_course_modules').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_courses').delete().eq('kajabi_id', COURSE)
  }

  const rows = async (table: string) =>
    (await bronze.from(table).select('*').eq(table === 'kajabi_courses' ? 'kajabi_id' : 'course_kajabi_id', COURSE)).data ?? []

  beforeAll(cleanup)
  afterAll(cleanup)
  beforeEach(() => {
    fake.fail = false
  })

  it('creates the course, module, lessons and offer on first import', async () => {
    fake.response = courseResponse([{ id: L1, title: 'One' }, { id: L2, title: 'Two' }])
    const response = await importCourse()
    expect(response.status).toBe(200)
    expect((await response.json()).courses[0]).toMatchObject({ modules: 1, lessons: 2, offers: 1, unplacedLessons: 0 })

    expect(await rows('kajabi_courses')).toHaveLength(1)
    expect(await rows('kajabi_course_modules')).toHaveLength(1)
    const lessons = await rows('kajabi_course_lessons')
    expect(lessons.map((l: any) => l.title).sort()).toEqual(['One', 'Two'])
    expect(lessons.every((l: any) => l.module_kajabi_id === M1 && l.deleted_at === null)).toBe(true)
    expect(await rows('kajabi_course_offers')).toHaveLength(1)
  })

  it('creates no duplicates when the same data is imported again, and leaves step B content alone', async () => {
    // Step B (a separate script) fills the content columns between imports.
    await bronze.from('kajabi_course_lessons').update({ body_html: '<p>kept</p>', video_media_id: 'media-1' }).eq('kajabi_id', L1)

    for (let i = 0; i < 3; i++) expect((await importCourse()).status).toBe(200)

    expect(await rows('kajabi_courses')).toHaveLength(1)
    expect(await rows('kajabi_course_modules')).toHaveLength(1)
    expect(await rows('kajabi_course_lessons')).toHaveLength(2)
    expect(await rows('kajabi_course_offers')).toHaveLength(1)
    const { data: l1 } = await bronze.from('kajabi_course_lessons').select('body_html, video_media_id').eq('kajabi_id', L1).single()
    expect(l1).toEqual({ body_html: '<p>kept</p>', video_media_id: 'media-1' })
  })

  it('updates a changed lesson in place', async () => {
    fake.response = courseResponse([{ id: L1, title: 'One, renamed' }, { id: L2, title: 'Two' }])
    expect((await importCourse()).status).toBe(200)

    const lessons = await rows('kajabi_course_lessons')
    expect(lessons).toHaveLength(2)
    expect(lessons.find((l: any) => l.kajabi_id === L1)?.title).toBe('One, renamed')
  })

  it('soft-deletes a lesson Kajabi no longer returns, and undeletes it when it comes back', async () => {
    fake.response = courseResponse([{ id: L1, title: 'One, renamed' }])
    const response = await importCourse()
    expect((await response.json()).softDeleted.lessons).toBe(1)

    let lessons = await rows('kajabi_course_lessons')
    expect(lessons).toHaveLength(2)
    expect(lessons.find((l: any) => l.kajabi_id === L2)?.deleted_at).not.toBeNull()
    expect(lessons.find((l: any) => l.kajabi_id === L1)?.deleted_at).toBeNull()

    fake.response = courseResponse([{ id: L1, title: 'One, renamed' }, { id: L2, title: 'Two' }])
    expect((await importCourse()).status).toBe(200)
    lessons = await rows('kajabi_course_lessons')
    expect(lessons.find((l: any) => l.kajabi_id === L2)?.deleted_at).toBeNull()
  })

  it('writes and soft-deletes nothing when a Kajabi call fails', async () => {
    fake.response = courseResponse([{ id: L1, title: 'One, renamed' }])
    fake.fail = true
    const response = await importCourse()
    expect(response.status).toBe(500)

    const lessons = await rows('kajabi_course_lessons')
    expect(lessons.every((l: any) => l.deleted_at === null)).toBe(true)
  })

  it('refuses a course id Kajabi does not have', async () => {
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/import/kajabi-courses`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseIds: ['no-such-course'] }),
    })
    expect(response.status).toBe(404)
  })

  it('rejects unauthenticated requests', async () => {
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/import/kajabi-courses`, { method: 'POST' })
    expect(response.status).toBe(401)
  })
})
