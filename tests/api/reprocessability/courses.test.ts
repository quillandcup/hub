import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/process/courses is reprocessable (Silver pattern: UPSERT on the source key so ids stay
 * stable, DELETE orphans):
 * 1. First run creates the course, modules, lessons and access from Bronze + Local
 * 2. Draft lessons stay hidden, locked ones show as "coming soon", text is sanitized
 * 3. Re-running keeps every id (and so every /courses/... URL)
 * 4. A lesson deleted or drafted in Kajabi disappears; a changed one updates
 * 5. Access follows active purchases: a refund removes it, grants add to it
 * 6. The slug set at creation never changes, even if the Kajabi title does
 *
 * Bronze rows are inserted directly (the import is tested in tests/api/idempotency), under ids
 * and emails unique to this run, so nothing else in the shared local database is touched.
 */

const ts = Date.now()
const COURSE = `test-pc-${ts}`
const TITLE = `Process Course ${ts}`
const SLUG = `process-course-${ts}`
const M_MONTH = `${COURSE}-month`
const M_WEEK = `${COURSE}-week`
const M_DRAFT = `${COURSE}-draftmod`
const L = (n: string) => `${COURSE}-l-${n}`
const OFFER = `${COURSE}-offer`
const CUSTOMER_BUYER = `${COURSE}-cust-buyer`
const CUSTOMER_REFUND = `${COURSE}-cust-refund`
const BUYER_EMAIL = `process-course-buyer-${ts}@example.com`
const REFUND_EMAIL = `process-course-refund-${ts}@example.com`
const PURCHASE_BUYER = `${COURSE}-p-buyer`
const PURCHASE_REFUND = `${COURSE}-p-refund`

describe('Courses processing (Bronze -> Silver) reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  let buyerId: string
  let refundId: string
  let granteeId: string

  const lessonRow = (n: string, over: Record<string, unknown> = {}) => ({
    kajabi_id: L(n),
    course_kajabi_id: COURSE,
    module_kajabi_id: M_WEEK,
    position: 1,
    title: `Lesson ${n}`,
    publishing_option: 'published',
    ...over,
  })

  async function process(body: Record<string, unknown> = { course: SLUG, accessDuration: '1 year' }) {
    return apiFetch(`${getTestApiBaseUrl()}/api/process/courses`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const silverCourse = async () => (await supabase.from('courses').select('*').eq('source_key', COURSE).maybeSingle()).data
  const silverLessons = async () =>
    (await supabase.from('course_lessons').select('*').eq('course_id', (await silverCourse())!.id)).data ?? []
  const silverModules = async () =>
    (await supabase.from('course_modules').select('*').eq('course_id', (await silverCourse())!.id)).data ?? []
  const access = async () =>
    (await supabase.from('course_access').select('*').eq('course_id', (await silverCourse())!.id)).data ?? []

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE) // cascades to modules, lessons, access, grants
    await bronze.from('kajabi_purchases').delete().like('kajabi_purchase_id', `${COURSE}-%`)
    await bronze.from('kajabi_customers').delete().like('kajabi_customer_id', `${COURSE}-%`)
    await bronze.from('kajabi_course_offers').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_course_modules').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_courses').delete().eq('kajabi_id', COURSE)
    await supabase.from('members').delete().like('email', `process-course-%-${ts}@example.com`)
  }

  beforeAll(async () => {
    await cleanup()

    const { data: members, error } = await supabase
      .from('members')
      .insert(
        [BUYER_EMAIL, REFUND_EMAIL, `process-course-grantee-${ts}@example.com`].map((email, i) => ({
          name: `Process Course Member ${i}`,
          email,
          joined_at: new Date().toISOString(),
          status: 'active',
        }))
      )
      .select('id, email')
    expect(error).toBeNull()
    const idOf = (prefix: string) => members!.find((m) => m.email.startsWith(prefix))!.id
    buyerId = idOf('process-course-buyer')
    refundId = idOf('process-course-refund')
    granteeId = idOf('process-course-grantee')

    await bronze.from('kajabi_courses').insert({
      kajabi_id: COURSE,
      title: TITLE,
      raw_payload: { attributes: { title: TITLE, description: 'About' } },
    })
    await bronze.from('kajabi_course_modules').insert([
      { kajabi_id: M_MONTH, course_kajabi_id: COURSE, position: 1, title: 'Month 1', publishing_option: 'published' },
      { kajabi_id: M_WEEK, course_kajabi_id: COURSE, parent_kajabi_id: M_MONTH, position: 1, title: 'Week 1', publishing_option: 'published' },
      { kajabi_id: M_DRAFT, course_kajabi_id: COURSE, position: 2, title: 'Not ready', publishing_option: 'draft' },
    ])
    await bronze.from('kajabi_course_lessons').insert([
      lessonRow('open', { position: 1, body_html: '<p onclick="x()">Hello</p><script>alert(1)</script>' }),
      lessonRow('soon', { position: 2, publishing_option: 'locked' }),
      lessonRow('draft', { position: 3, publishing_option: 'draft' }),
      lessonRow('indraftmod', { module_kajabi_id: M_DRAFT }),
      lessonRow('removed', { position: 4 }),
    ])
    await bronze.from('kajabi_course_offers').insert({ course_kajabi_id: COURSE, offer_kajabi_id: OFFER })
    await bronze.from('kajabi_customers').insert([
      { kajabi_customer_id: CUSTOMER_BUYER, email: BUYER_EMAIL, data: {} },
      { kajabi_customer_id: CUSTOMER_REFUND, email: REFUND_EMAIL, data: {} },
    ])
    await bronze.from('kajabi_purchases').insert([
      { kajabi_purchase_id: PURCHASE_BUYER, kajabi_customer_id: CUSTOMER_BUYER, kajabi_offer_id: OFFER, created_at_kajabi: '2026-03-01T00:00:00Z', data: {} },
      { kajabi_purchase_id: PURCHASE_REFUND, kajabi_customer_id: CUSTOMER_REFUND, kajabi_offer_id: OFFER, created_at_kajabi: '2026-03-01T00:00:00Z', deactivated_at: '2026-04-01T00:00:00Z', data: {} },
    ])
  })

  afterAll(cleanup)

  it('creates the course, its visible modules and lessons, and access, on first run', async () => {
    const response = await process()
    expect(response.status).toBe(200)
    const result = (await response.json()).courses[0]
    expect(result).toMatchObject({ slug: SLUG, created: true, modules: 2, lessons: 3, comingSoon: 1, hiddenLessons: 2 })

    const course = await silverCourse()
    expect(course).toMatchObject({ slug: SLUG, title: TITLE, description: 'About', source: 'kajabi', kind: 'evergreen' })

    const modules = await silverModules()
    const month = modules.find((m: any) => m.source_key === M_MONTH)
    const week = modules.find((m: any) => m.source_key === M_WEEK)
    expect(modules.map((m: any) => m.source_key).sort()).toEqual([M_MONTH, M_WEEK].sort())
    expect(week.parent_id).toBe(month.id)
    expect(month.parent_id).toBeNull()

    const lessons = await silverLessons()
    expect(Object.fromEntries(lessons.map((l: any) => [l.source_key, l.state]))).toEqual({ [L('open')]: 'open', [L('soon')]: 'coming_soon', [L('removed')]: 'open' })
    expect(lessons.find((l: any) => l.source_key === L('open'))!.module_id).toBe(week.id)
  })

  it('sanitizes lesson text', async () => {
    const open = (await silverLessons()).find((l: any) => l.source_key === L('open'))!
    expect(open.body_html).toBe('<p>Hello</p>')
  })

  it('gives access for an active purchase for the course duration, and none for a refunded one', async () => {
    const rows = await access()
    expect(rows.map((r: any) => r.member_id)).toEqual([buyerId])
    expect(rows[0]).toMatchObject({ origin: 'purchase' })
    expect(new Date(rows[0].starts_at).toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(new Date(rows[0].ends_at).toISOString()).toBe('2027-03-01T00:00:00.000Z')
    expect(rows.some((r: any) => r.member_id === refundId)).toBe(false)
  })

  it('keeps every id when run again (stable URLs)', async () => {
    const before = {
      course: (await silverCourse())!.id,
      modules: (await silverModules()).map((m: any) => m.id).sort(),
      lessons: (await silverLessons()).map((l: any) => l.id).sort(),
    }
    // The access duration is already stored on the course; omitting it must leave it alone.
    for (let i = 0; i < 2; i++) expect((await process({ course: SLUG })).status).toBe(200)

    expect((await silverCourse())!.id).toBe(before.course)
    expect((await silverModules()).map((m: any) => m.id).sort()).toEqual(before.modules)
    expect((await silverLessons()).map((l: any) => l.id).sort()).toEqual(before.lessons)
    expect((await access())).toHaveLength(1)
  })

  it('updates a changed lesson in place', async () => {
    const idBefore = (await silverLessons()).find((l: any) => l.source_key === L('open'))!.id
    await bronze.from('kajabi_course_lessons').update({ title: 'Lesson open, renamed', body_html: '<h2>New</h2>' }).eq('kajabi_id', L('open'))
    expect((await process({ course: SLUG })).status).toBe(200)

    const open = (await silverLessons()).find((l: any) => l.source_key === L('open'))!
    expect(open).toMatchObject({ id: idBefore, title: 'Lesson open, renamed', body_html: '<h2>New</h2>' })
  })

  it('opens a lesson once Kajabi publishes it, and removes one that is deleted or drafted again', async () => {
    await bronze.from('kajabi_course_lessons').update({ publishing_option: 'published' }).eq('kajabi_id', L('soon'))
    await bronze.from('kajabi_course_lessons').update({ publishing_option: 'draft' }).eq('kajabi_id', L('open'))
    await bronze.from('kajabi_course_lessons').update({ deleted_at: new Date().toISOString() }).eq('kajabi_id', L('removed'))
    const response = await process({ course: SLUG })
    expect(response.status).toBe(200)

    const lessons = await silverLessons()
    expect(Object.fromEntries(lessons.map((l: any) => [l.source_key, l.state]))).toEqual({ [L('soon')]: 'open' })
  })

  it('removes a module that Kajabi hides, with what is inside it', async () => {
    await bronze.from('kajabi_course_modules').update({ publishing_option: 'draft' }).eq('kajabi_id', M_MONTH)
    expect((await process({ course: SLUG })).status).toBe(200)

    expect(await silverModules()).toHaveLength(0)
    expect(await silverLessons()).toHaveLength(0)
    await bronze.from('kajabi_course_modules').update({ publishing_option: 'published' }).eq('kajabi_id', M_MONTH)
  })

  it('removes access when a purchase is refunded, and adds a staff grant', async () => {
    await bronze.from('kajabi_purchases').update({ deactivated_at: new Date().toISOString() }).eq('kajabi_purchase_id', PURCHASE_BUYER)
    await supabase.from('course_access_grants').insert({ member_id: granteeId, course_id: (await silverCourse())!.id, ends_at: null })
    const response = await process({ course: SLUG })
    expect(response.status).toBe(200)
    expect((await response.json()).courses[0].access).toEqual({ members: 1, removed: 1 })

    const rows = await access()
    expect(rows.map((r: any) => r.member_id)).toEqual([granteeId])
    expect(rows[0]).toMatchObject({ origin: 'grant', ends_at: null })
  })

  it('keeps the slug when the Kajabi title changes', async () => {
    await bronze.from('kajabi_courses').update({ title: `${TITLE} (new name)`, raw_payload: { attributes: { title: `${TITLE} (new name)` } } }).eq('kajabi_id', COURSE)
    expect((await process({ course: SLUG })).status).toBe(200)

    expect(await silverCourse()).toMatchObject({ slug: SLUG, title: `${TITLE} (new name)` })
  })

  it('refuses a slug that matches no Kajabi course, and names what is known', async () => {
    const response = await process({ course: 'no-such-course' })
    expect(response.status).toBe(404)
    expect((await response.json()).error).toContain(SLUG)
  })

  it('answers 400 for a malformed body and 401 without credentials', async () => {
    const bad = await apiFetch(`${getTestApiBaseUrl()}/api/process/courses`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(bad.status).toBe(400)
    expect((await apiFetch(`${getTestApiBaseUrl()}/api/process/courses`, { method: 'POST' })).status).toBe(401)
  })
})
