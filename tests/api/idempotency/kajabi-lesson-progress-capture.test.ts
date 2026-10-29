import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { ProgressSessionExpiredError, runProgressCapture } from '@/lib/kajabi/progress-run'

/**
 * `courses:content --progress` (lib/kajabi/progress-run.ts) is idempotent (Bronze pattern: UPSERT on the natural
 * key, soft-delete what a full snapshot no longer lists):
 * 1. First capture writes the roster to kajabi_product_progress and each student's lessons to kajabi_lesson_progress
 * 2. Capturing the same data again writes nothing
 * 3. A changed lesson updates in place; a lesson no longer listed is soft-deleted
 * 4. A student whose report fails (or lists no lessons) writes nothing, and nobody else is touched
 * 5. A dry run counts but writes nothing; a 401 stops the run
 * 6. More than 1000 lessons for one student are all stored and read back
 * 7. A roster that disagrees with its own count removes no one
 *
 * Everything is scoped to fake course ids and example.com emails.
 */

const ts = Date.now()
const COURSE = `test-klp-${ts}`
const OTHER = `test-klp-other-${ts}`
const email = (n: string) => `klp-${n}-${ts}@example.com`
const ROSTER_URL = 'https://app.example.test/api/client/reports/product_progress/9?productId=9&site_id=3'
const TZ = 'America/New_York'

type Post = { id: number; completed: boolean; completed_date: string | null; progress_percent: number }
const post = (id: number, completed: boolean, date: string | null = null): Post => ({
  id,
  completed,
  completed_date: completed ? date : null,
  progress_percent: completed ? 100 : 0,
})
const report = (memberId: number, posts: Post[]) => ({
  member: { id: memberId, contact_id: memberId + 1000 },
  product: { categories: [{ id: 1, posts }] },
})
const rosterMember = (memberId: number, who: string, percent = 50) => ({
  contact_id: memberId + 1000,
  member_id: memberId,
  email: email(who),
  name: `Example ${who}`,
  percent_complete: percent,
  sign_in_count: 3,
  start_date: '2026-01-05',
  last_request_at: '2026-02-01T15:00:00Z',
})

describe('Kajabi per-lesson progress capture idempotency', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')

  // What each student's report says right now; tests change it between runs.
  let reports = new Map<number, { status: number; json?: unknown }>()
  const fetchReport = async (url: string) => {
    const id = Number(new URL(url).pathname.split('/').pop())
    return reports.get(id) ?? { status: 404 }
  }
  const run = (rosterMembers: unknown[], over: Partial<Parameters<typeof runProgressCapture>[0]> = {}, course = COURSE) =>
    runProgressCapture({
      db: supabase,
      courseKajabiId: course,
      roster: { url: ROSTER_URL, json: { count: rosterMembers.length, members: rosterMembers } },
      fetchReport: over.fetchReport ?? fetchReport,
      apply: true,
      timeZone: TZ,
      delayMs: 0,
      sleep: async () => undefined,
      ...over,
    })

  const lessonRows = async (course: string, who: string) =>
    ((await bronze.from('kajabi_lesson_progress').select('*').eq('course_kajabi_id', course).eq('email', email(who)).order('kajabi_lesson_id')).data ?? []) as any[]
  const rosterRows = async (course: string) =>
    ((await bronze.from('kajabi_product_progress').select('*').eq('course_kajabi_id', course).order('email')).data ?? []) as any[]

  async function cleanup() {
    for (const t of ['kajabi_lesson_progress', 'kajabi_product_progress']) await bronze.from(t).delete().in('course_kajabi_id', [COURSE, OTHER])
    await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_courses').delete().in('kajabi_id', [COURSE, OTHER])
  }

  beforeAll(async () => {
    await cleanup()
    await bronze.from('kajabi_courses').insert([
      { kajabi_id: COURSE, title: `Test Course ${ts}` },
      { kajabi_id: OTHER, title: `Other Course ${ts}` },
    ])
    await bronze.from('kajabi_course_lessons').insert([
      { kajabi_id: '5001', course_kajabi_id: COURSE, position: 1, title: 'One', publishing_option: 'published' },
      { kajabi_id: '5002', course_kajabi_id: COURSE, position: 2, title: 'Two', publishing_option: 'published' },
    ])
  })
  afterAll(cleanup)

  it('writes the roster and each student\'s lessons on a first capture', async () => {
    reports = new Map([
      [1, { status: 200, json: report(1, [post(5001, true, '2026-01-05'), post(5002, false), post(5999, true, '2026-01-06T10:00:00Z')]) }],
      [2, { status: 200, json: report(2, [post(5001, false), post(5002, false)]) }],
    ])
    const summary = await run([rosterMember(1, 'ada', 80), rosterMember(2, 'bo', 10)])
    expect(summary).toMatchObject({
      members: 2,
      membersCaptured: 2,
      membersFailed: 0,
      lessonsListed: 5,
      lessonsCompleted: 2,
      lessonsNotInBronze: 1,
      roster: { written: 2, unchanged: 0, removed: 0 },
      lessons: { written: 5, unchanged: 0, removed: 0 },
    })

    expect(await rosterRows(COURSE)).toHaveLength(2)
    expect((await rosterRows(COURSE))[0]).toMatchObject({ email: email('ada'), percent: 80, logins: 3, started_on: '2026-01-05', last_activity_on: '2026-02-01' })
    const ada = await lessonRows(COURSE, 'ada')
    expect(ada.map((r) => [r.kajabi_lesson_id, r.completed])).toEqual([
      ['5001', true],
      ['5002', false],
      ['5999', true],
    ])
    expect(ada[0]).toMatchObject({ completed_at: '2026-01-05T17:00:00+00:00', kajabi_member_id: '1', kajabi_contact_id: '1001', deleted_at: null })
  })

  it('writes nothing when the same data is captured again', async () => {
    const before = [await lessonRows(COURSE, 'ada'), await lessonRows(COURSE, 'bo'), await rosterRows(COURSE)]
    for (let i = 0; i < 2; i++) {
      const summary = await run([rosterMember(1, 'ada', 80), rosterMember(2, 'bo', 10)])
      expect(summary).toMatchObject({ roster: { written: 0, unchanged: 2, removed: 0 }, lessons: { written: 0, unchanged: 5, removed: 0 } })
    }
    expect([await lessonRows(COURSE, 'ada'), await lessonRows(COURSE, 'bo'), await rosterRows(COURSE)]).toEqual(before)
  })

  it('updates a changed lesson in place and soft-deletes one no longer listed', async () => {
    reports.set(1, { status: 200, json: report(1, [post(5001, true, '2026-01-05'), post(5002, true, '2026-02-01')]) })
    const summary = await run([rosterMember(1, 'ada', 90), rosterMember(2, 'bo', 10)])
    expect(summary.lessons).toEqual({ written: 1, unchanged: 3, removed: 1 })

    const ada = await lessonRows(COURSE, 'ada')
    expect(ada.find((r) => r.kajabi_lesson_id === '5002')).toMatchObject({ completed: true, deleted_at: null })
    expect(ada.find((r) => r.kajabi_lesson_id === '5999')?.deleted_at).not.toBeNull()
  })

  it('writes nothing for a student whose report fails or lists no lessons, and leaves the others alone', async () => {
    const adaBefore = await lessonRows(COURSE, 'ada')
    reports.set(1, { status: 500 })
    reports.set(2, { status: 200, json: { member: { id: 2 }, product: { categories: [] } } })
    const lines: string[] = []
    const summary = await run([rosterMember(1, 'ada', 90), rosterMember(2, 'bo', 10)], { log: (l) => lines.push(l) })
    expect(summary).toMatchObject({ membersCaptured: 0, membersFailed: 1, membersWithoutLessons: 1, lessons: { written: 0, unchanged: 0, removed: 0 } })
    expect(lines.join('\n')).toContain('Kajabi answered 500 for /api/client/reports/product_progress/9/members/:id')
    expect(lines.join('\n')).not.toContain('klp-')
    expect(await lessonRows(COURSE, 'ada')).toEqual(adaBefore)
    expect((await lessonRows(COURSE, 'bo')).filter((r) => r.deleted_at !== null)).toHaveLength(0)
  })

  it('refuses a report that is for a different student', async () => {
    reports.set(1, { status: 200, json: report(77, [post(5001, false)]) })
    const summary = await run([rosterMember(1, 'ada', 90)])
    expect(summary.membersFailed).toBe(1)
  })

  it('counts a dry run without writing', async () => {
    reports.set(1, { status: 200, json: report(1, [post(5001, false)]) })
    const before = await lessonRows(COURSE, 'ada')
    const summary = await run([rosterMember(1, 'ada', 5)], { apply: false })
    expect(summary.lessons.written).toBe(1)
    expect(summary.roster.written).toBe(1)
    expect(await lessonRows(COURSE, 'ada')).toEqual(before)
    expect((await rosterRows(COURSE)).find((r) => r.email === email('ada'))?.percent).toBe(90)
  })

  it('stops on a 401 and names the status and path, not a student', async () => {
    const expired = async () => ({ status: 401 })
    await expect(run([rosterMember(1, 'ada')], { fetchReport: expired })).rejects.toThrow(ProgressSessionExpiredError)
    await expect(run([rosterMember(1, 'ada')], { fetchReport: expired })).rejects.toThrow('401 for /api/client/reports/product_progress/9/members/:id')
  })

  it('does not remove students from a roster whose count disagrees with what it sent', async () => {
    const before = await rosterRows(COURSE)
    const lines: string[] = []
    const summary = await runProgressCapture({
      db: supabase,
      courseKajabiId: COURSE,
      roster: { url: ROSTER_URL, json: { count: 500, members: [rosterMember(1, 'ada', 90)] } },
      fetchReport,
      apply: true,
      timeZone: TZ,
      delayMs: 0,
      sleep: async () => undefined,
      log: (l) => lines.push(l),
    })
    expect(summary.rosterCountMismatch).toBe(true)
    expect(summary.roster.removed).toBe(0)
    expect(lines.join('\n')).toContain('may be paged or filtered')
    expect((await rosterRows(COURSE)).filter((r) => r.deleted_at === null)).toHaveLength(before.filter((r) => r.deleted_at === null).length)
  })

  it('removes a student a complete roster no longer lists, and never touches another course', async () => {
    await run([rosterMember(9, 'zed')], { fetchReport: async () => ({ status: 200, json: report(9, [post(5001, true, '2026-01-05')]) }) }, OTHER)
    reports.set(1, { status: 200, json: report(1, [post(5001, false)]) })
    reports.set(2, { status: 200, json: report(2, [post(5001, false)]) })
    // An earlier test's roster already dropped the second student; bring them back, then drop them again.
    const back = await run([rosterMember(1, 'ada', 5), rosterMember(2, 'bo', 10)])
    expect(back.roster.removed).toBe(0)
    expect((await rosterRows(COURSE)).find((r) => r.email === email('bo'))?.deleted_at).toBeNull()
    const summary = await run([rosterMember(1, 'ada', 5)])
    expect(summary.roster.removed).toBe(1)
    expect((await rosterRows(COURSE)).find((r) => r.email === email('bo'))?.deleted_at).not.toBeNull()
    expect((await rosterRows(OTHER)).filter((r) => r.deleted_at === null)).toHaveLength(1)
    expect(await lessonRows(OTHER, 'zed')).toHaveLength(1)
  })

  it('stores and re-reads more than 1000 lessons for one student', async () => {
    const posts = Array.from({ length: 1100 }, (_, i) => post(20000 + i, i % 2 === 0, '2026-01-05'))
    reports.set(3, { status: 200, json: report(3, posts) })
    const first = await run([rosterMember(3, 'big')])
    expect(first.lessons).toMatchObject({ written: 1100, unchanged: 0, removed: 0 })
    const again = await run([rosterMember(3, 'big')])
    expect(again.lessons).toEqual({ written: 0, unchanged: 1100, removed: 0 })
    reports.set(3, { status: 200, json: report(3, posts.slice(0, 1050)) })
    expect((await run([rosterMember(3, 'big')])).lessons).toEqual({ written: 0, unchanged: 1050, removed: 50 })
  })
})
