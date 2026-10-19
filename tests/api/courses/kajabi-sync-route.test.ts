import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * The standard Kajabi sync (/api/import/kajabi) also syncs courses, after the members, and a
 * courses problem is reported in the response without failing the member sync.
 * Kajabi is faked (empty member data, one course); member Silver processing is stubbed out.
 */

const ts = Date.now()
const COURSE = `test-krs-${ts}`
const state = vi.hoisted(() => ({ coursesFail: false }))

vi.mock('@/lib/processing/trigger', () => ({
  triggerReprocessing: vi.fn(async () => ({ processed: [] })),
}))
vi.mock('@/lib/kajabi/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kajabi/client')>()),
  createKajabiClient: () => ({
    fetchAllContacts: async () => [],
    fetchAllCustomers: async () => [],
    fetchAllSubscriptions: async () => [],
    fetchAllOffers: async () => [],
    fetchAllCourses: async () => {
      if (state.coursesFail) throw new Error('courses endpoint down')
      return [{ id: COURSE, type: 'courses', attributes: {} }]
    },
    fetchCourse: async () => ({
      data: { id: COURSE, type: 'courses', attributes: { title: `Route Sync ${ts}` } },
      included: [{ id: `${COURSE}-l`, type: 'lessons', attributes: { title: 'L', position: 1, publishing_option: 'published' }, relationships: {} }],
    }),
  }),
}))

describe('/api/import/kajabi course sync', () => {
  const supabase = getTestSupabaseAdminClient()

  async function cleanup() {
    await supabase.schema('bronze').from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await supabase.schema('bronze').from('kajabi_courses').delete().eq('kajabi_id', COURSE)
  }
  const sync = () => apiFetch(`${getTestApiBaseUrl()}/api/import/kajabi`, { method: 'POST', headers: getTestAuthHeaders() })

  beforeAll(cleanup)
  afterAll(cleanup)
  beforeEach(() => {
    state.coursesFail = false
  })

  it('includes the courses result next to the members one', async () => {
    const response = await sync()
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.members).toBeTruthy()
    expect(body.courses.error).toBeUndefined()
    expect(body.courses.imported.courses.find((c: any) => c.id === COURSE)).toMatchObject({ lessons: 1 })
    expect(body.courses.unpublished.find((c: any) => c.id === COURSE)).toMatchObject({ slug: `route-sync-${ts}` })
  })

  it('still succeeds, reporting the problem, when the courses part fails', async () => {
    state.coursesFail = true
    const response = await sync()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.members).toBeTruthy()
    expect(body.courses.error).toBe('courses endpoint down')
  })
})
