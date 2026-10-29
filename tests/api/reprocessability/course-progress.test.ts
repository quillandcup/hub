import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/process/course-progress (Bronze Kajabi per-lesson progress -> Silver lesson_progress). Hub progress is
 * member-written and Local, so this is an insert-if-absent merge, not DELETE + INSERT:
 * 1. A dry run counts and writes nothing
 * 2. First run inserts a completed row (marked imported, Kajabi's date, no position) for matched members with access
 * 3. Running again inserts nothing; a row the member has (completed or not) is never changed
 * 4. Unmatched, ambiguous and no-access members and orphan lessons are counted, not written
 * 5. Members are found by email or alias, never by name; a member whose access ended gets nothing
 * 6. Only completed, live Bronze rows count; a lesson later removed in Bronze is not imported
 * 7. More than 1000 rows are imported
 * 8. No member_activities are written
 *
 * Bronze, courses and lessons are inserted directly under ids and emails unique to this run.
 */

const ts = Date.now()
const COURSE = `test-cp-${ts}`
const SLUG = `progress-course-${ts}`
const email = (n: string) => `cp-${n}-${ts}@example.com`
const KEY = (n: string | number) => `${COURSE}-l-${n}`

describe('Kajabi lesson progress -> lesson_progress', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  const ids: Record<string, string> = {}
  let courseId: string
  const lessonIds: Record<string, string> = {}
  const BIG = 1100

  const post = (body: Record<string, unknown> = { course: SLUG }) =>
    apiFetch(`${getTestApiBaseUrl()}/api/process/course-progress`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const run = async (body?: Record<string, unknown>) => {
    const res = await post(body)
    const json = await res.json()
    expect(res.status).toBe(200)
    return json.courses.find((c: any) => c.slug === SLUG)
  }
  const progress = async (who: string) =>
    ((await supabase.from('lesson_progress').select('*').eq('member_id', ids[who]).order('lesson_id')).data ?? []) as any[]
  const bronzeRow = (who: string, lesson: string, over: Record<string, unknown> = {}) => ({
    course_kajabi_id: COURSE,
    email: email(who),
    kajabi_lesson_id: KEY(lesson),
    completed: true,
    completed_at: '2026-01-05T17:00:00Z',
    ...over,
  })

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE) // cascades to lessons, access and their progress
    await bronze.from('kajabi_lesson_progress').delete().eq('course_kajabi_id', COURSE)
    await supabase.from('member_email_aliases').delete().eq('alias_email', email('bo-old'))
    await supabase.from('members').delete().like('email', `cp-%-${ts}@example.com`)
    await supabase.from('members').delete().like('email', `CP-%-${ts}@example.com`)
  }

  beforeAll(async () => {
    await cleanup()
    const names = ['ada', 'bo', 'cy', 'dee', 'eve', 'fay', 'gus', 'big']
    const rows = [
      ...names.map((n) => ({ name: `Progress ${n}`, email: email(n) })),
      { name: 'Progress cy twin', email: email('cy').replace('cp-cy', 'CP-CY') },
    ]
    const { data, error } = await supabase
      .from('members')
      .insert(rows.map((r) => ({ ...r, joined_at: new Date().toISOString(), status: 'active' })))
      .select('id, email')
    expect(error).toBeNull()
    for (const n of names) ids[n] = data!.find((m) => m.email === email(n))!.id
    await supabase.from('member_email_aliases').insert({ canonical_email: email('bo'), alias_email: email('bo-old'), source: 'manual' })

    const course = await supabase.from('courses').insert({ slug: SLUG, title: `Progress ${ts}`, source: 'kajabi', source_key: COURSE }).select('id').single()
    expect(course.error).toBeNull()
    courseId = course.data!.id
    const lessonRows = [...['1', '2', '3'], ...Array.from({ length: BIG }, (_, i) => `big${i}`)].map((n, i) => ({
      course_id: courseId,
      title: `Lesson ${n}`,
      position: i,
      source: 'kajabi',
      source_key: KEY(n),
    }))
    for (let i = 0; i < lessonRows.length; i += 500) {
      const { data: inserted, error: lessonError } = await supabase.from('course_lessons').insert(lessonRows.slice(i, i + 500)).select('id, source_key')
      expect(lessonError).toBeNull()
      for (const l of inserted!) lessonIds[l.source_key.replace(`${COURSE}-l-`, '')] = l.id
    }

    const day = 86400000
    const access = (who: string, endsAt: string | null = null) => ({
      member_id: ids[who],
      course_id: courseId,
      starts_at: new Date(Date.now() - 30 * day).toISOString(),
      ends_at: endsAt,
      origin: 'grant',
    })
    const accessInsert = await supabase
      .from('course_access')
      .insert([access('ada'), access('bo'), access('cy'), access('eve', new Date(Date.now() - day).toISOString()), access('fay'), access('gus'), access('big')])
    expect(accessInsert.error).toBeNull()

    // fay already finished lesson 1 in the Hub; gus started lesson 1 and has a position.
    await supabase.from('lesson_progress').insert([
      { member_id: ids.fay, lesson_id: lessonIds['1'], completed_at: '2026-03-01T12:00:00Z', last_position_seconds: 55 },
      { member_id: ids.gus, lesson_id: lessonIds['1'], completed_at: null, last_position_seconds: 30 },
    ])

    await bronze.from('kajabi_lesson_progress').insert([
      bronzeRow('ada', '1'),
      bronzeRow('ada', '2', { completed_at: '2026-01-06T10:00:00Z' }),
      bronzeRow('ada', '3', { completed: false, completed_at: null }), // not complete in Kajabi
      bronzeRow('ada', 'gone'), // no such Silver lesson
      bronzeRow('bo-old', '1'), // an old address, through the alias
      bronzeRow('cy', '1'), // two members share this email apart from case
      bronzeRow('dee', '1'), // member without access
      bronzeRow('eve', '1'), // access ended
      bronzeRow('ghost', '1'), // no member at all
      bronzeRow('fay', '1', { completed_at: '2026-01-05T17:00:00Z' }), // Hub already completed it, on another date
      bronzeRow('gus', '1'), // Hub row exists but is not completed
      bronzeRow('fay', '2', { deleted_at: new Date().toISOString() }), // soft-deleted in Bronze
    ])
    const big = Array.from({ length: BIG }, (_, i) => bronzeRow('big', `big${i}`))
    for (let i = 0; i < big.length; i += 500) {
      const { error: bigError } = await bronze.from('kajabi_lesson_progress').insert(big.slice(i, i + 500))
      expect(bigError).toBeNull()
    }
  })
  afterAll(cleanup)

  it('counts a dry run and writes nothing', async () => {
    const summary = await run({ course: SLUG, dryRun: true })
    expect(summary.inserted).toBe(3 + BIG)
    expect(await progress('ada')).toHaveLength(0)
    expect(await progress('big')).toHaveLength(0)
  })

  it('inserts completed rows for matched members with access, marked imported, and counts the rest', async () => {
    const summary = await run()
    expect(summary).toMatchObject({
      slug: SLUG,
      completedInBronze: 10 + BIG, // ada x3 (1, 2, gone), bo, cy, dee, eve, ghost, fay, gus, big
      orphanLessons: 1,
      alreadyCompleted: 1,
      leftAlone: 1,
      inserted: 3 + BIG,
      students: { unmatched: 1, ambiguous: 1, withoutAccess: 2 },
    })

    const ada = await progress('ada')
    expect(ada.map((r) => [r.lesson_id, r.completed_at, r.last_position_seconds, r.imported_from])).toEqual(
      [
        [lessonIds['1'], '2026-01-05T17:00:00+00:00', 0, 'kajabi'],
        [lessonIds['2'], '2026-01-06T10:00:00+00:00', 0, 'kajabi'],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    )
    expect(await progress('bo')).toHaveLength(1) // found through the alias
    expect(await progress('big')).toHaveLength(BIG)
  })

  it('leaves unmatched, ambiguous, no-access and ended-access members without rows', async () => {
    for (const who of ['cy', 'dee', 'eve']) expect(await progress(who)).toHaveLength(0)
  })

  it('never changes a row the member already has', async () => {
    expect(await progress('fay')).toEqual([
      expect.objectContaining({ lesson_id: lessonIds['1'], completed_at: '2026-03-01T12:00:00+00:00', last_position_seconds: 55, imported_from: null }),
    ])
    expect(await progress('gus')).toEqual([
      expect.objectContaining({ lesson_id: lessonIds['1'], completed_at: null, last_position_seconds: 30, imported_from: null }),
    ])
  })

  it('inserts nothing when run again, and still never lowers or overwrites', async () => {
    const before = await progress('ada')
    const again = await run()
    expect(again.inserted).toBe(0)
    expect(again.alreadyCompleted).toBe(1 + 3 + BIG) // fay, ada x2 + bo, big
    expect(await progress('ada')).toEqual(before)
  })

  it('does not undo a lesson the member un-completed in the Hub', async () => {
    await supabase.from('lesson_progress').update({ completed_at: null }).eq('member_id', ids.ada).eq('lesson_id', lessonIds['2'])
    const summary = await run()
    expect(summary.inserted).toBe(0)
    expect((await progress('ada')).find((r) => r.lesson_id === lessonIds['2']).completed_at).toBeNull()
  })

  it('does not import a lesson Bronze later stops listing as completed', async () => {
    await bronze.from('kajabi_lesson_progress').update({ deleted_at: new Date().toISOString() }).eq('course_kajabi_id', COURSE).eq('email', email('bo-old'))
    await supabase.from('lesson_progress').delete().eq('member_id', ids.bo)
    expect((await run()).inserted).toBe(0)
    expect(await progress('bo')).toHaveLength(0)
  })

  it('writes no activity-log rows', async () => {
    const { count } = await supabase.from('member_activities').select('id', { count: 'exact', head: true }).in('member_id', [ids.ada, ids.big])
    expect(count).toBe(0)
  })

  it('answers 404 for an unknown course and 400 for a malformed body', async () => {
    expect((await post({ course: `no-such-course-${ts}` })).status).toBe(404)
    const bad = await apiFetch(`${getTestApiBaseUrl()}/api/process/course-progress`, { method: 'POST', headers: getTestAuthHeaders(), body: '{nope' })
    expect(bad.status).toBe(400)
  })

  it('refuses a caller who is not an admin', async () => {
    const res = await apiFetch(`${getTestApiBaseUrl()}/api/process/course-progress`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })
})
