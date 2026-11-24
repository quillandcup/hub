import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/process/course-comments (Bronze Kajabi lesson comments -> Silver lesson_comments). Hub comments are Local, so the import
 * only ever writes rows marked `source = 'kajabi'`, keyed on `source_key`:
 * 1. A dry run counts and writes nothing
 * 2. The first run inserts every comment with no member, the author's name, Kajabi's time, replies under their comment
 * 3. Running again changes nothing (idempotent, no duplicates)
 * 4. An edited comment is updated; a staff hide is kept; a comment removed in Kajabi is soft deleted and restored when listed again
 * 5. Comments on lessons the Hub does not have are counted, not written
 * 6. No follow, report, hold or notification is created
 * 7. More than 1000 comments are imported
 *
 * Bronze, the course and its lessons are inserted directly under keys unique to this run.
 */

const ts = Date.now()
const COURSE = `test-cc-${ts}`
const SLUG = `comments-course-${ts}`
const KEY = (n: string | number) => `${COURSE}-l-${n}`
const BIG = 1100

describe('Kajabi lesson comments -> lesson_comments', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  let courseId: string
  const lessonIds: Record<string, string> = {}

  const post = (body: Record<string, unknown> = { course: SLUG }) =>
    apiFetch(`${getTestApiBaseUrl()}/api/process/course-comments`, {
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
  const imported = async () =>
    ((await supabase.from('lesson_comments').select('*').eq('source', 'kajabi').in('lesson_id', Object.values(lessonIds)).order('source_key')).data ?? []) as any[]
  const row = (lesson: string, key: string, over: Record<string, unknown> = {}) => ({
    course_kajabi_id: COURSE,
    lesson_kajabi_id: KEY(lesson),
    comment_key: key,
    author_name: `Pen Name ${key}`,
    posted_at: '2025-02-03T10:00:00Z',
    body: `Comment ${key}`,
    ...over,
  })

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE) // cascades to lessons and their comments
    await bronze.from('kajabi_lesson_comments').delete().eq('course_kajabi_id', COURSE)
  }

  beforeAll(async () => {
    await cleanup()
    const course = await supabase.from('courses').insert({ slug: SLUG, title: `Comments ${ts}`, source: 'kajabi', source_key: COURSE }).select('id').single()
    expect(course.error).toBeNull()
    courseId = course.data!.id
    const inserted = await supabase
      .from('course_lessons')
      .insert(['1', '2'].map((n, i) => ({ course_id: courseId, title: `Lesson ${n}`, position: i, source: 'kajabi', source_key: KEY(n) })))
      .select('id, source_key')
    expect(inserted.error).toBeNull()
    for (const l of inserted.data!) lessonIds[l.source_key.replace(`${COURSE}-l-`, '')] = l.id

    const seed = await bronze.from('kajabi_lesson_comments').insert([
      row('1', 'c1', { posted_at: '2025-01-01T09:00:00Z' }),
      row('1', 'c2', { parent_comment_key: 'c1', posted_at: '2025-01-02T09:00:00Z' }),
      row('1', 'c3', { parent_comment_key: 'c2' }), // a reply to a reply goes under c1
      row('1', 'c4', { parent_comment_key: 'nowhere' }), // its comment is not captured
      row('2', 'c5', { body: '<p>Hello <b>there</b></p>' }),
      row('gone', 'c6'), // a lesson the Hub does not have
      row('1', 'c7', { deleted_at: '2026-01-01T00:00:00Z' }), // removed in Kajabi before the Hub ever had it
    ])
    expect(seed.error).toBeNull()
  })

  afterAll(cleanup)

  it('a dry run counts and writes nothing', async () => {
    const summary = await run({ course: SLUG, dryRun: true })
    expect(summary).toMatchObject({ commentsInBronze: 7, inserted: 5, unmatchedLessonComments: 1, skipped: 1, orphanReplies: 1, replies: 3 })
    expect(await imported()).toHaveLength(0)
  })

  it('imports with no member, the original time, the name and the thread; creates nothing else', async () => {
    const summary = await run()
    expect(summary).toMatchObject({ inserted: 5, updated: 0, unchanged: 0 })

    const rows = await imported()
    expect(rows).toHaveLength(5)
    const byKey = new Map(rows.map((r) => [r.source_key, r]))
    const c1 = byKey.get(`${KEY('1')}/c1`)
    expect(c1).toMatchObject({ member_id: null, author_name: 'Pen Name c1', body: 'Comment c1', parent_id: null, is_staff_reply: false, held_at: null, hidden_at: null, deleted_at: null, edited_at: null })
    expect(new Date(c1.created_at).toISOString()).toBe('2025-01-01T09:00:00.000Z')
    expect(byKey.get(`${KEY('1')}/c2`).parent_id).toBe(c1.id)
    expect(byKey.get(`${KEY('1')}/c3`).parent_id).toBe(c1.id)
    expect(byKey.get(`${KEY('1')}/c4`).parent_id).toBeNull()
    expect(byKey.get(`${KEY('2')}/c5`).body).toBe('Hello there')

    const ids = rows.map((r) => r.id)
    expect((await supabase.from('lesson_comment_follows').select('id').in('lesson_id', Object.values(lessonIds))).data).toEqual([])
    expect((await supabase.from('lesson_comment_reports').select('id').in('comment_id', ids)).data).toEqual([])
  })

  it('running again changes nothing and duplicates nothing', async () => {
    const before = await imported()
    const summary = await run()
    expect(summary).toMatchObject({ inserted: 0, updated: 0, unchanged: 5 })
    expect(await imported()).toEqual(before)
  })

  it('updates an edited comment, keeps a staff hide, removes what Kajabi removed and restores it when listed again', async () => {
    const c1 = (await imported()).find((r) => r.source_key === `${KEY('1')}/c1`)
    await supabase.from('lesson_comments').update({ hidden_at: '2026-11-01T00:00:00Z' }).eq('id', c1.id)
    await bronze.from('kajabi_lesson_comments').update({ body: 'Comment c1, edited', author_name: 'Renamed' }).eq('lesson_kajabi_id', KEY('1')).eq('comment_key', 'c1')
    await bronze.from('kajabi_lesson_comments').update({ deleted_at: '2026-11-10T00:00:00Z' }).eq('lesson_kajabi_id', KEY('1')).eq('comment_key', 'c4')

    expect(await run()).toMatchObject({ inserted: 0, updated: 2, removed: 1, restored: 0 })
    let rows = await imported()
    expect(rows.find((r) => r.id === c1.id)).toMatchObject({ body: 'Comment c1, edited', author_name: 'Renamed' })
    expect(new Date(rows.find((r) => r.id === c1.id).hidden_at).toISOString()).toBe('2026-11-01T00:00:00.000Z')
    const c4 = rows.find((r) => r.source_key === `${KEY('1')}/c4`)
    expect(c4.deleted_at).not.toBeNull()
    expect(c4.deleted_by).toBeNull()
    expect(rows).toHaveLength(5)

    await bronze.from('kajabi_lesson_comments').update({ deleted_at: null }).eq('lesson_kajabi_id', KEY('1')).eq('comment_key', 'c4')
    expect(await run()).toMatchObject({ updated: 1, restored: 1 })
    rows = await imported()
    expect(rows.find((r) => r.source_key === `${KEY('1')}/c4`).deleted_at).toBeNull()
    expect(await run()).toMatchObject({ updated: 0, inserted: 0 })
  })

  it('imports more than 1000 comments, once', async () => {
    const many = Array.from({ length: BIG }, (_, i) => row('2', `big${String(i).padStart(4, '0')}`))
    for (let i = 0; i < many.length; i += 500) {
      const { error } = await bronze.from('kajabi_lesson_comments').insert(many.slice(i, i + 500))
      expect(error).toBeNull()
    }
    expect(await run()).toMatchObject({ inserted: BIG })
    expect(await run()).toMatchObject({ inserted: 0, updated: 0, unchanged: BIG + 5 })
    const { count } = await supabase.from('lesson_comments').select('id', { count: 'exact', head: true }).eq('source', 'kajabi').eq('lesson_id', lessonIds['2'])
    expect(count).toBe(BIG + 1)
  })

  it('rejects an unknown course and a missing body, and answers 401 without credentials', async () => {
    const unknown = await post({ course: `nope-${ts}` })
    expect(unknown.status).toBe(404)
    const bad = await apiFetch(`${getTestApiBaseUrl()}/api/process/course-comments`, { method: 'POST', headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' }, body: 'not json' })
    expect(bad.status).toBe(400)
    const anonymous = await apiFetch(`${getTestApiBaseUrl()}/api/process/course-comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect([401, 403]).toContain(anonymous.status)
  })
})
