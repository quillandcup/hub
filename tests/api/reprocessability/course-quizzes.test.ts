import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/process/courses syncs the quizzes captured from Kajabi (bronze.kajabi_quizzes) into Silver quizzes, and is reprocessable:
 * 1. First run attaches a quiz to its lesson with its questions and options, on Kajabi's keys
 * 2. Re-running keeps every id (so a member's attempt keeps pointing at the same question) and adds nothing
 * 3. A changed capture updates in place; a question Kajabi dropped goes, the attempt stays
 * 4. A quiz whose Bronze row is retired (the lesson is a plain lesson again) is removed; a quiz made in the Hub is never touched
 * 5. A capture the reading can't make sense of changes nothing and is counted, not deleted
 * 6. A lesson that is no longer Kajabi's (taken over) is left alone
 *
 * Bronze rows are inserted directly under ids unique to this run, so nothing else in the shared local database is touched.
 */

const ts = Date.now()
const COURSE = `test-pq-${ts}`
const SLUG = `process-quiz-${ts}`
const M = `${COURSE}-m`
const L_QUIZ = `${COURSE}-l-quiz`
const L_PLAIN = `${COURSE}-l-plain`
const QUIZ = `${ts}1`
const EMAIL = `process-quiz-member-${ts}@example.com`

const document = (over: { passing?: number | null; questions?: string[] } = {}) => {
  const ids = over.questions ?? ['11', '12']
  const answers = ids.flatMap((q) => [
    { id: `${q}1`, type: 'quiz_answers', attributes: { text: `Answer ${q}-a`, correct: false } },
    { id: `${q}2`, type: 'quiz_answers', attributes: { text: `Answer ${q}-b`, correct: true } },
  ])
  return {
    data: {
      id: QUIZ,
      type: 'quizzes',
      attributes: { title: 'Check in', ...(over.passing ? { passing_grade: over.passing } : {}) },
      relationships: { questions: { data: ids.map((id) => ({ id, type: 'quiz_questions' })) } },
    },
    included: [
      ...ids.map((q, i) => ({
        id: q,
        type: 'quiz_questions',
        attributes: { body: `Question ${q}`, position: i + 1 },
        relationships: { answers: { data: [{ id: `${q}1`, type: 'quiz_answers' }, { id: `${q}2`, type: 'quiz_answers' }] } },
      })),
      ...answers,
    ],
  }
}

describe('Course quizzes processing (Bronze -> Silver) reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  let memberId: string

  async function process() {
    return apiFetch(`${getTestApiBaseUrl()}/api/process/courses`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ course: SLUG }),
    })
  }
  const capture = (documents: unknown[], over: Record<string, unknown> = {}) =>
    bronze.from('kajabi_quizzes').upsert({ kajabi_id: QUIZ, course_kajabi_id: COURSE, lesson_kajabi_id: L_QUIZ, raw_payload: { documents }, content_hash: JSON.stringify(documents).length.toString(), deleted_at: null, ...over }, { onConflict: 'kajabi_id' })

  const silverCourse = async () => (await supabase.from('courses').select('*').eq('source_key', COURSE).maybeSingle()).data
  const lessonId = async (key: string) => (await supabase.from('course_lessons').select('id').eq('course_id', (await silverCourse())!.id).eq('source_key', key).maybeSingle()).data?.id as string
  const quiz = async () => (await supabase.from('quizzes').select('*').eq('lesson_id', await lessonId(L_QUIZ)).maybeSingle()).data
  const questions = async () => {
    const q = await quiz()
    if (!q) return []
    const { data } = await supabase.from('quiz_questions').select('id, position, prompt, source_key').eq('quiz_id', q.id).order('position')
    return data ?? []
  }
  const options = async () => {
    const ids = (await questions()).map((q) => q.id)
    const { data } = await supabase.from('quiz_options').select('id, label, is_correct, source_key').in('question_id', ids.length ? ids : ['none'])
    return data ?? []
  }

  async function cleanup() {
    await supabase.from('courses').delete().eq('source_key', COURSE) // cascades to lessons, quizzes, attempts
    await bronze.from('kajabi_quizzes').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_course_modules').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_courses').delete().eq('kajabi_id', COURSE)
    await supabase.from('members').delete().eq('email', EMAIL)
  }

  beforeAll(async () => {
    await cleanup()
    const { data, error } = await supabase.from('members').insert({ name: 'Process Quiz Member', email: EMAIL, joined_at: new Date().toISOString(), status: 'active' }).select('id').single()
    expect(error).toBeNull()
    memberId = data!.id
    await bronze.from('kajabi_courses').insert({ kajabi_id: COURSE, title: `Process Quiz ${ts}`, raw_payload: { attributes: { title: `Process Quiz ${ts}` } } })
    await bronze.from('kajabi_course_modules').insert({ kajabi_id: M, course_kajabi_id: COURSE, position: 1, title: 'Month 1', publishing_option: 'published' })
    await bronze.from('kajabi_course_lessons').insert([
      { kajabi_id: L_QUIZ, course_kajabi_id: COURSE, module_kajabi_id: M, position: 1, title: "Let's Check In", publishing_option: 'published' },
      { kajabi_id: L_PLAIN, course_kajabi_id: COURSE, module_kajabi_id: M, position: 2, title: 'A plain lesson', publishing_option: 'published' },
    ])
    expect((await capture([document({ passing: 80 })])).error).toBeNull()
  })

  afterAll(cleanup)

  it('attaches the quiz to its lesson with its questions and options, on Kajabi keys', async () => {
    const response = await process()
    expect(response.status).toBe(200)
    expect((await response.json()).courses[0].quizzes).toMatchObject({ synced: 1, questions: 2, removed: 0, unreadable: 0, noLesson: 0 })

    expect(await quiz()).toMatchObject({ source_key: QUIZ, passing_percent: 80, hide_answers: false })
    expect((await questions()).map((q) => [q.position, q.prompt, q.source_key])).toEqual([[1, 'Question 11', '11'], [2, 'Question 12', '12']])
    expect((await options()).filter((o) => o.is_correct).map((o) => o.label).sort()).toEqual(['Answer 11-b', 'Answer 12-b'])
    // The plain lesson stays plain.
    expect((await supabase.from('quizzes').select('id').eq('lesson_id', await lessonId(L_PLAIN))).data).toEqual([])
  })

  it('keeps every id when run again, so a member\'s attempt still points at the same question', async () => {
    const before = { quiz: (await quiz())!.id, questions: (await questions()).map((q) => q.id), options: (await options()).map((o) => o.id).sort() }
    const attempt = await supabase.from('quiz_attempts').insert({ quiz_id: before.quiz, member_id: memberId, question_count: 2, correct_count: 1, score_percent: 50, passed: false }).select('id').single()
    await supabase.from('quiz_attempt_answers').insert({ attempt_id: attempt.data!.id, question_id: before.questions[0], selected_option_ids: [], is_correct: true })

    expect((await process()).status).toBe(200)

    expect({ quiz: (await quiz())!.id, questions: (await questions()).map((q) => q.id), options: (await options()).map((o) => o.id).sort() }).toEqual(before)
    expect((await supabase.from('quiz_attempt_answers').select('question_id').eq('attempt_id', attempt.data!.id)).data).toEqual([{ question_id: before.questions[0] }])
  })

  it('updates a changed capture in place and drops a question Kajabi dropped, keeping the attempt', async () => {
    const first = (await questions())[0]
    expect((await capture([document({ passing: 90, questions: ['11'] })])).error).toBeNull()

    expect((await process()).status).toBe(200)

    expect(await quiz()).toMatchObject({ passing_percent: 90 })
    expect((await questions()).map((q) => [q.id, q.source_key])).toEqual([[first.id, '11']])
    expect((await supabase.from('quiz_attempts').select('id').eq('member_id', memberId)).data).toHaveLength(1)
  })

  it('counts a capture it cannot read and changes nothing for it', async () => {
    expect((await capture([{ nothing: 'useful' }])).error).toBeNull()
    const response = await process()
    expect((await response.json()).courses[0].quizzes).toMatchObject({ synced: 0, unreadable: 1, removed: 0 })
    expect((await questions()).map((q) => q.source_key)).toEqual(['11'])
  })

  it('removes the quiz once its capture is retired, and leaves a quiz made in the Hub alone', async () => {
    const plain = await lessonId(L_PLAIN)
    // A quiz made in the Hub on a Kajabi lesson can't happen through the app; this one has no Kajabi key, as a Hub quiz wouldn't.
    expect((await supabase.from('quizzes').insert({ lesson_id: plain }).select('id').single()).error).toBeNull()
    await bronze.from('kajabi_quizzes').update({ deleted_at: new Date().toISOString() }).eq('kajabi_id', QUIZ)

    const response = await process()

    expect((await response.json()).courses[0].quizzes).toMatchObject({ removed: 1 })
    expect(await quiz()).toBeNull()
    expect((await supabase.from('quizzes').select('id').eq('lesson_id', plain)).data).toHaveLength(1)
    expect((await supabase.from('quiz_attempts').select('id').eq('member_id', memberId)).data).toEqual([])
  })

  it('leaves the quiz of a lesson alone once the lesson is no longer Kajabi\'s (taken over)', async () => {
    expect((await capture([document({ passing: 70 })])).error).toBeNull()
    expect((await process()).status).toBe(200)
    expect(await quiz()).toMatchObject({ passing_percent: 70 })

    // The lesson becomes the Hub's (a take-over flips the whole course, which the import then skips; here only the lesson,
    // the harshest case: the import now sees no Kajabi lesson under that key and makes a fresh one).
    const taken = await lessonId(L_QUIZ)
    await supabase.from('course_lessons').update({ source: 'hub' }).eq('id', taken)
    expect((await capture([document({ passing: 50 })])).error).toBeNull()

    const response = await process()

    expect(response.status).toBe(200)
    expect((await supabase.from('quizzes').select('passing_percent').eq('lesson_id', taken).single()).data).toEqual({ passing_percent: 70 })
  })
})
