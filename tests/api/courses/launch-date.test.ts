import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'
import { ORG_TIMEZONE } from '@/lib/config'
import { zonedTimeToUtc } from '@/lib/prickle-schedules'
import { loadCourseView, loadCourseList } from '@/lib/courses/member'

/**
 * Pre-orders: a course's launch date moves early buyers' access start (and so its end) to launch,
 * leaves later buyers at their purchase date, and until launch the member sees "opens on", not
 * the course. Real database and the real route.
 */

const ts = Date.now()
const COURSE = `test-launch-${ts}`
const TITLE = `Launch Course ${ts}`
const SLUG = `launch-course-${ts}`
const OFFER = `${COURSE}-offer`

describe('Course launch date', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  const ids: Record<string, string> = {}
  const day = (n: number) => new Date(Date.now() + n * 86_400_000)
  const launchOn = (d: Date) => d.toISOString().slice(0, 10)

  async function process(body: Record<string, unknown>) {
    return apiFetch(`${getTestApiBaseUrl()}/api/process/courses`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ course: SLUG, publish: true, ...body }),
    })
  }
  const accessOf = async (who: string) =>
    (await supabase.from('course_access').select('*').eq('member_id', ids[who]).eq('course_id', ids.course).maybeSingle()).data

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE)
    await bronze.from('kajabi_purchases').delete().like('kajabi_purchase_id', `${COURSE}-%`)
    await bronze.from('kajabi_customers').delete().like('kajabi_customer_id', `${COURSE}-%`)
    await bronze.from('kajabi_course_offers').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_courses').delete().eq('kajabi_id', COURSE)
    await supabase.from('members').delete().like('email', `launch-%-${ts}@example.com`)
  }

  beforeAll(async () => {
    await cleanup()
    const emails = { early: `launch-early-${ts}@example.com`, late: `launch-late-${ts}@example.com` }
    const { data: members } = await supabase
      .from('members')
      .insert(Object.values(emails).map((email, i) => ({ name: `Launch ${i}`, email, joined_at: new Date().toISOString(), status: 'active' })))
      .select('id, email')
    ids.early = members!.find((m) => m.email === emails.early)!.id
    ids.late = members!.find((m) => m.email === emails.late)!.id

    await bronze.from('kajabi_courses').insert({ kajabi_id: COURSE, title: TITLE, raw_payload: { attributes: { title: TITLE } } })
    await bronze.from('kajabi_course_lessons').insert({ kajabi_id: `${COURSE}-l`, course_kajabi_id: COURSE, position: 1, title: 'L', publishing_option: 'published' })
    await bronze.from('kajabi_course_offers').insert({ course_kajabi_id: COURSE, offer_kajabi_id: OFFER })
    await bronze.from('kajabi_customers').insert([
      { kajabi_customer_id: `${COURSE}-c-early`, email: emails.early, data: {} },
      { kajabi_customer_id: `${COURSE}-c-late`, email: emails.late, data: {} },
    ])
    await bronze.from('kajabi_purchases').insert([
      { kajabi_purchase_id: `${COURSE}-p-early`, kajabi_customer_id: `${COURSE}-c-early`, kajabi_offer_id: OFFER, created_at_kajabi: day(-5).toISOString(), data: {} },
      { kajabi_purchase_id: `${COURSE}-p-late`, kajabi_customer_id: `${COURSE}-c-late`, kajabi_offer_id: OFFER, created_at_kajabi: day(10).toISOString(), data: {} },
    ])
  })
  afterAll(cleanup)

  it('starts early buyers at launch and keeps a later buyer at their purchase date', async () => {
    const launch = day(3)
    const response = await process({ accessDuration: '1 year', launchOn: launchOn(launch) })
    expect(response.status).toBe(200)
    ids.course = (await supabase.from('courses').select('id, launch_at').eq('source_key', COURSE).single()).data!.id

    const expectedLaunch = zonedTimeToUtc(launchOn(launch), '00:00', ORG_TIMEZONE)
    const early = await accessOf('early')
    expect(new Date(early!.starts_at).toISOString()).toBe(expectedLaunch.toISOString())
    const endsOn = new Date(expectedLaunch)
    endsOn.setUTCFullYear(endsOn.getUTCFullYear() + 1)
    expect(new Date(early!.ends_at).toISOString()).toBe(endsOn.toISOString())

    const late = await accessOf('late')
    expect(new Date(late!.starts_at).getTime()).toBeGreaterThan(expectedLaunch.getTime())
  })

  it("shows the early buyer 'opens on' before launch: listed, but none of the course", async () => {
    const scope = { memberId: ids.early, isAdminActing: false }
    const [item] = (await loadCourseList(supabase, scope)).filter((i) => i.course.slug === SLUG)
    expect(item.access.kind).toBe('upcoming')

    const view = await loadCourseView(supabase, SLUG, scope)
    expect(view).toMatchObject({ access: { kind: 'upcoming' }, outline: null })
  })

  it('leaves the launch date alone when it is not sent, and clears it with null', async () => {
    expect((await process({})).status).toBe(200)
    expect((await supabase.from('courses').select('launch_at').eq('id', ids.course).single()).data!.launch_at).not.toBeNull()

    expect((await process({ launchOn: null })).status).toBe(200)
    expect((await supabase.from('courses').select('launch_at').eq('id', ids.course).single()).data!.launch_at).toBeNull()
    const early = await accessOf('early')
    expect(new Date(early!.starts_at).getTime()).toBeLessThan(Date.now()) // back to the purchase date
  })

  it('refuses a launch date that is not a date', async () => {
    for (const launchOn of ['next week', '2026-13-45', 20261102]) {
      expect((await process({ launchOn })).status).toBe(400)
    }
  })
})
