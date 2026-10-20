import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'
import { COURSE_FILES_BUCKET } from '@/lib/courses/files'

/** /api/process/course-files: the admin's "copy the lesson downloads" action, end to end. */

const ts = Date.now()
const COURSE = `test-cf-${ts}`
const SLUG = `cf-course-${ts}`

describe('/api/process/course-files', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  const post = (body: unknown, headers: Record<string, string> = getTestAuthHeaders()) =>
    apiFetch(`${getTestApiBaseUrl()}/api/process/course-files`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  async function cleanup() {
    const { data: course } = await supabase.from('courses').select('id').eq('source_key', COURSE).maybeSingle()
    if (course) {
      const { data: rows } = await supabase.from('course_lesson_files').select('storage_path, course_lessons!inner(course_id)').eq('course_lessons.course_id', course.id)
      if (rows?.length) await supabase.storage.from(COURSE_FILES_BUCKET).remove(rows.map((r) => r.storage_path))
    }
    await supabase.from('courses').delete().eq('source_key', COURSE)
    await bronze.from('kajabi_lesson_files').delete().like('kajabi_id', `${COURSE}-%`)
    await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_courses').delete().eq('kajabi_id', COURSE)
  }

  beforeAll(async () => {
    await supabase.storage.createBucket(COURSE_FILES_BUCKET, { public: false })
    // Only the fake Kajabi link is faked; the database and Storage clients keep the real fetch.
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (typeof input === 'string' && new URL(input).hostname === 'kajabi.test') return new Response('%PDF demo', { status: 200, headers: { 'content-type': 'application/pdf' } })
      return realFetch(input, init)
    })
    await cleanup()
    await bronze.from('kajabi_courses').insert({ kajabi_id: COURSE, title: `CF Course ${ts}`, raw_payload: { attributes: { title: `CF Course ${ts}` } } })
    await bronze.from('kajabi_course_lessons').insert({ kajabi_id: `${COURSE}-l`, course_kajabi_id: COURSE, position: 1, title: 'L', publishing_option: 'published' })
    await bronze.from('kajabi_lesson_files').insert({
      kajabi_id: `${COURSE}-f`, lesson_kajabi_id: `${COURSE}-l`, filename: 'Sheet.pdf', raw_payload: { position: 1 },
      source_url: `https://kajabi.test/Sheet.pdf?X-Amz-Date=${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}&X-Amz-Expires=604800`,
    })
    // A published Hub course with its lesson (what step C creates).
    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `CF Course ${ts}`, source_key: COURSE }).select('id').single()
    await supabase.from('course_lessons').insert({ course_id: course!.id, title: 'L', source_key: `${COURSE}-l` })
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    await cleanup()
  })

  it('refuses without credentials, a bad body, or for a course that is not published', async () => {
    expect((await apiFetch(`${getTestApiBaseUrl()}/api/process/course-files`, { method: 'POST' })).status).toBe(401)
    const bad = await apiFetch(`${getTestApiBaseUrl()}/api/process/course-files`, { method: 'POST', headers: getTestAuthHeaders(), body: '{nope' })
    expect(bad.status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await post({ course: `no-such-${ts}` })).status).toBe(404)
  })

  it('copies the course\'s files, then has nothing left to copy', async () => {
    const response = await post({ course: SLUG })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.copied).toMatchObject([{ filename: 'Sheet.pdf' }])

    const row = (await supabase.from('course_lesson_files').select('storage_path, size_bytes').eq('source_key', `${COURSE}-f`).single()).data!
    expect(row.size_bytes).toBe('%PDF demo'.length)
    expect((await supabase.storage.from(COURSE_FILES_BUCKET).download(row.storage_path)).error).toBeNull()

    const again = await (await post({ course: SLUG })).json()
    expect(again.copied).toEqual([])
    expect(again.alreadyCopied).toBe(1)
  })
})
