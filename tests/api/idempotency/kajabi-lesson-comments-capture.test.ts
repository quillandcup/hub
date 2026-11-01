import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { CommentsSessionExpiredError, runCommentsCapture, type LessonRead } from '@/lib/kajabi/comments-run'
import type { RawComment } from '@/lib/kajabi/comments-capture'

/**
 * `courses:content --comments` (lib/kajabi/comments-run.ts) is idempotent (Bronze pattern: UPSERT on the natural
 * key, soft-delete what a full snapshot no longer lists):
 * 1. First capture writes each lesson's comments to kajabi_lesson_comments
 * 2. Capturing the same data again writes nothing
 * 3. A changed body updates in place; a comment no longer listed is soft-deleted
 * 4. A lesson whose page failed, was cut off, or has no list writes nothing, and other lessons and courses are untouched
 * 5. A dry run counts but writes nothing; a login redirect stops the run
 * 6. More than 1000 comments on one lesson are all stored and read back
 *
 * Everything is scoped to fake course and lesson ids and made-up people.
 */

const ts = Date.now()
const COURSE = `test-klc-${ts}`
const OTHER = `test-klc-other-${ts}`
const L1 = `${ts}1`
const L2 = `${ts}2`
const L3 = `${ts}3`
const BIG = `${ts}4`
const OTHER_LESSON = `${ts}9`
const TZ = 'America/New_York'

const raw = (index: number, id: number, name: string, body: string, parentIndex: number | null = null): RawComment => ({
  index,
  parentIndex,
  name,
  datetime: `2026-06-${String(10 + (index % 10)).padStart(2, '0')}T15:00:00Z`,
  body,
  idCandidates: [{ source: 'reply-link', name: 'parent_id', value: String(id) }],
})

describe('Kajabi lesson comments capture idempotency', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')

  // What each lesson's page says right now; tests change it between runs.
  let pages = new Map<string, LessonRead | Error>()
  const readLesson = async (lesson: { lessonKajabiId: string }) => {
    const page = pages.get(lesson.lessonKajabiId)
    if (!page) throw new Error('no such page')
    if (page instanceof Error) throw page
    return page
  }
  const ok = (comments: RawComment[], over: { total?: number | null; capped?: boolean } = {}): LessonRead => ({
    kind: 'ok',
    page: { comments, total: over.total === undefined ? comments.length : over.total },
    capped: over.capped ?? false,
  })
  const run = (ids: string[], over: Partial<Parameters<typeof runCommentsCapture>[0]> = {}, course = COURSE) =>
    runCommentsCapture({
      db: supabase,
      courseKajabiId: course,
      lessons: ids.map((id) => ({ lessonKajabiId: id, url: `/products/x/posts/${id}` })),
      readLesson,
      apply: true,
      timeZone: TZ,
      delayMs: 0,
      sleep: async () => undefined,
      ...over,
    })
  const rows = async (lesson: string) => ((await bronze.from('kajabi_lesson_comments').select('*').eq('lesson_kajabi_id', lesson).order('comment_key').range(0, 4999)).data ?? []) as any[]

  async function cleanup() {
    await bronze.from('kajabi_lesson_comments').delete().in('course_kajabi_id', [COURSE, OTHER])
    await bronze.from('kajabi_course_lessons').delete().in('course_kajabi_id', [COURSE, OTHER])
    await bronze.from('kajabi_courses').delete().in('kajabi_id', [COURSE, OTHER])
  }

  beforeAll(async () => {
    await cleanup()
    await bronze.from('kajabi_courses').insert([
      { kajabi_id: COURSE, title: `Test Course ${ts}` },
      { kajabi_id: OTHER, title: `Other Course ${ts}` },
    ])
    await bronze.from('kajabi_course_lessons').insert(
      [L1, L2, L3, BIG].map((id, i) => ({ kajabi_id: id, course_kajabi_id: COURSE, position: i + 1, title: `Lesson ${i + 1}`, publishing_option: 'published' })).concat([
        { kajabi_id: OTHER_LESSON, course_kajabi_id: OTHER, position: 1, title: 'Other', publishing_option: 'published' },
      ]),
    )
  })
  afterAll(cleanup)

  it('writes each lesson\'s comments on a first capture, replies pointing at their parent', async () => {
    pages = new Map<string, LessonRead | Error>([
      [L1, ok([raw(0, 111, 'Ada Example', 'First!'), raw(1, 112, 'Bo Sample', 'Welcome', 0), raw(2, 113, 'Cy Demo', 'Hi')])],
      [L2, ok([raw(0, 211, 'Ada Example', 'Second lesson')])],
      [L3, ok([])],
    ])
    const summary = await run([L1, L2, L3, `${ts}0000`])
    expect(summary).toMatchObject({
      lessonsListed: 4,
      lessonsNotInBronze: 1,
      lessonsCaptured: 3,
      lessonsWithComments: 2,
      comments: 4,
      replies: 1,
      rows: { written: 4, unchanged: 0, removed: 0 },
      keySources: { 'reply-link': 4, hash: 0 },
      lessonsFailed: 0,
    })
    const l1 = await rows(L1)
    expect(l1.map((r) => [r.comment_key, r.parent_comment_key, r.author_name])).toEqual([
      ['111', null, 'Ada Example'],
      ['112', '111', 'Bo Sample'],
      ['113', null, 'Cy Demo'],
    ])
    expect(l1[0]).toMatchObject({ course_kajabi_id: COURSE, body: 'First!', deleted_at: null })
    expect(new Date(l1[0].posted_at).toISOString()).toBe('2026-06-10T15:00:00.000Z')
  })

  it('writes nothing when the same data is captured again', async () => {
    const before = [await rows(L1), await rows(L2)]
    for (let i = 0; i < 2; i++) {
      const summary = await run([L1, L2, L3])
      expect(summary.rows).toEqual({ written: 0, unchanged: 4, removed: 0 })
    }
    expect([await rows(L1), await rows(L2)]).toEqual(before)
  })

  it('updates a changed body in place and soft-deletes a comment no longer listed', async () => {
    pages.set(L1, ok([raw(0, 111, 'Ada Example', 'First, edited!'), raw(1, 112, 'Bo Sample', 'Welcome', 0)]))
    const summary = await run([L1, L2])
    expect(summary.rows).toEqual({ written: 1, unchanged: 2, removed: 1 })
    const l1 = await rows(L1)
    expect(l1.find((r) => r.comment_key === '111')).toMatchObject({ body: 'First, edited!', deleted_at: null })
    expect(l1.find((r) => r.comment_key === '113')?.deleted_at).not.toBeNull()
    expect((await rows(L2))[0].deleted_at).toBeNull()
  })

  it('brings a soft-deleted comment back when it is listed again', async () => {
    pages.set(L1, ok([raw(0, 111, 'Ada Example', 'First, edited!'), raw(1, 112, 'Bo Sample', 'Welcome', 0), raw(2, 113, 'Cy Demo', 'Hi')]))
    const summary = await run([L1])
    expect(summary.rows).toEqual({ written: 1, unchanged: 2, removed: 0 })
    expect((await rows(L1)).every((r) => r.deleted_at === null)).toBe(true)
  })

  it('writes nothing for a lesson that failed, was cut off or has no list, and leaves the rest alone', async () => {
    const before = [await rows(L1), await rows(L2)]
    pages.set(L1, new Error('the lesson page did not load'))
    pages.set(L2, ok([raw(0, 999, 'Zed', 'partial')], { capped: true }))
    pages.set(L3, { kind: 'noList' })
    const summary = await run([L1, L2, L3])
    expect(summary).toMatchObject({ lessonsFailed: 1, lessonsCapped: 1, lessonsWithoutList: 1, lessonsCaptured: 0, rows: { written: 0, unchanged: 0, removed: 0 } })
    expect([await rows(L1), await rows(L2)]).toEqual(before)
  })

  it('does not remove comments when the page shows more than was read, and reports the mismatch', async () => {
    pages.set(L1, ok([raw(0, 111, 'Ada Example', 'First, edited!')], { total: 3 }))
    const summary = await run([L1])
    expect(summary).toMatchObject({ lessonsMismatched: 1, rows: { written: 0, unchanged: 1, removed: 0 } })
    expect((await rows(L1)).filter((r) => r.deleted_at === null)).toHaveLength(3)
  })

  it('counts a dry run but writes nothing', async () => {
    pages.set(L2, ok([raw(0, 211, 'Ada Example', 'Changed in a dry run')]))
    const summary = await run([L2], { apply: false })
    expect(summary.rows.written).toBe(1)
    expect((await rows(L2))[0].body).toBe('Second lesson')
  })

  it('stops the run on a login redirect', async () => {
    pages.set(L1, new CommentsSessionExpiredError('login'))
    await expect(run([L1])).rejects.toBeInstanceOf(CommentsSessionExpiredError)
  })

  it('leaves another course\'s lessons untouched', async () => {
    pages.set(OTHER_LESSON, ok([raw(0, 777, 'Dee Sample', 'Elsewhere')]))
    await run([OTHER_LESSON], {}, OTHER)
    pages.set(L2, ok([]))
    await run([L2])
    expect((await rows(OTHER_LESSON)).map((r) => r.deleted_at)).toEqual([null])
  })

  it('stores and reads back more than 1000 comments on one lesson', async () => {
    const many = Array.from({ length: 1100 }, (_, i) => raw(i, 5000 + i, 'Ada Example', `Comment ${i}`))
    pages.set(BIG, ok(many))
    expect((await run([BIG])).rows).toEqual({ written: 1100, unchanged: 0, removed: 0 })
    expect((await run([BIG])).rows).toEqual({ written: 0, unchanged: 1100, removed: 0 })
    pages.set(BIG, ok(many.slice(0, 1050)))
    expect((await run([BIG])).rows).toEqual({ written: 0, unchanged: 1050, removed: 50 })
    expect((await rows(BIG)).filter((r) => r.deleted_at === null)).toHaveLength(1050)
  })
})
