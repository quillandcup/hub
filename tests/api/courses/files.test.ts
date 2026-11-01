import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { COURSE_FILES_BUCKET, copyCourseFiles, planCourseFiles } from '@/lib/courses/files'
import { createRepos } from "@/lib/data/repos";

/**
 * Lesson downloads into the Hub, against the real local database and Storage with a fake source:
 * every lesson's files, drafts' included and marked, are copied once into the private bucket with a
 * recorded row; links that have expired are reported; a file Kajabi no longer lists is removed.
 */

const ts = Date.now()
const COURSE = `test-files-${ts}`
const NOW = new Date('2026-10-20T12:00:00Z')
const link = (name: string, expires = 'X-Amz-Date=20261019T120000Z&X-Amz-Expires=604800') => `https://kajabi.test/${name}?${expires}&sig=1`
const EXPIRED = 'X-Amz-Date=20261001T120000Z&X-Amz-Expires=3600'

const sources: Record<string, { status?: number; body?: string; type?: string }> = {}
const download = (async (input: unknown) => {
  const name = new URL(String(input)).pathname.slice(1)
  const source = sources[name] ?? { body: `contents of ${name}`, type: 'binary/octet-stream' }
  return new Response(source.status && source.status >= 400 ? null : source.body, { status: source.status ?? 200, headers: { 'content-type': source.type ?? 'application/pdf' } })
}) as typeof fetch

describe('Course files step', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  const ids: Record<string, string> = {}

  async function cleanup() {
    const { data: lessons } = await supabase.from('course_lessons').select('id').eq('course_id', ids.course ?? '00000000-0000-0000-0000-000000000000')
    if (lessons?.length) {
      const { data: rows } = await supabase.from('course_lesson_files').select('storage_path').in('lesson_id', lessons.map((l) => l.id))
      if (rows?.length) await supabase.storage.from(COURSE_FILES_BUCKET).remove(rows.map((r) => r.storage_path))
    }
    await supabase.from('courses').delete().eq('source_key', COURSE) // cascades to lessons and file rows
    await bronze.from('kajabi_lesson_files').delete().like('kajabi_id', `${COURSE}-%`)
    await bronze.from('kajabi_course_lessons').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_course_modules').delete().eq('course_kajabi_id', COURSE)
    await bronze.from('kajabi_courses').delete().eq('kajabi_id', COURSE)
  }
  const rows = async () => (await supabase.from('course_lesson_files').select('*').like('source_key', `${COURSE}-%`)).data ?? []
  const exists = async (path: string) => !(await supabase.storage.from(COURSE_FILES_BUCKET).download(path)).error

  beforeAll(async () => {
    // The migration creates this bucket; make sure it is there on a database that hasn't had it applied.
    await supabase.storage.createBucket(COURSE_FILES_BUCKET, { public: false })
    await cleanup()

    await bronze.from('kajabi_courses').insert({ kajabi_id: COURSE, title: 'Files Course', raw_payload: {} })
    await bronze.from('kajabi_course_modules').insert([
      { kajabi_id: `${COURSE}-m-open`, course_kajabi_id: COURSE, position: 1, title: 'Open', publishing_option: 'published' },
      { kajabi_id: `${COURSE}-m-draft`, course_kajabi_id: COURSE, position: 2, title: 'Draft', publishing_option: 'draft' },
    ])
    const lesson = (n: string, module: string, over: Record<string, unknown> = {}) => ({
      kajabi_id: `${COURSE}-l-${n}`, course_kajabi_id: COURSE, module_kajabi_id: `${COURSE}-m-${module}`, position: 1, title: `Lesson ${n}`, publishing_option: 'published', ...over,
    })
    await bronze.from('kajabi_course_lessons').insert([lesson('a', 'open'), lesson('b', 'open'), lesson('draft', 'open', { publishing_option: 'draft' }), lesson('c', 'draft'), lesson('nohub', 'open')])
    const file = (n: string, lessonN: string, over: Record<string, unknown> = {}) => ({
      kajabi_id: `${COURSE}-f-${n}`, lesson_kajabi_id: `${COURSE}-l-${lessonN}`, filename: `${n}.pdf`, source_url: link(n), raw_payload: { position: n === 'second' ? 2 : 1 }, ...over,
    })
    await bronze.from('kajabi_lesson_files').insert([
      file('tracker', 'a'),
      file('second', 'a'),
      file('expired', 'b', { source_url: link('expired', EXPIRED) }),
      file('nolink', 'b', { source_url: null }),
      file('broken', 'b'),
      file('indraft', 'draft'),
      file('indraftmodule', 'c'),
      file('nohub', 'nohub'),
    ])
    sources.broken = { status: 500 }

    // The Hub course (as publishing makes it), without the lesson "nohub". Drafts are there too, hidden.
    const { data: course } = await supabase.from('courses').insert({ slug: `files-course-${ts}`, title: 'Files Course', source_key: COURSE }).select('id').single()
    ids.course = course!.id
    const hubLessons = [
      { n: 'a', state: 'open' },
      { n: 'b', state: 'open' },
      { n: 'draft', state: 'hidden' },
      { n: 'c', state: 'hidden' },
    ]
    const { data: hub } = await supabase.from('course_lessons').insert(hubLessons.map(({ n, state }) => ({ course_id: ids.course, title: `Lesson ${n}`, state, source_key: `${COURSE}-l-${n}` }))).select('id, source_key')
    for (const { n } of hubLessons) ids[n] = hub!.find((l) => l.source_key.endsWith(`-l-${n}`))!.id
  })
  afterAll(cleanup)

  it('plans every lesson\'s files, drafts\' marked, each with what it needs', async () => {
    const plan = await planCourseFiles(createRepos(supabase), COURSE, NOW)
    const byName = Object.fromEntries(plan.files.map((f) => [f.filename, f.state]))

    expect(byName).toEqual({
      'tracker.pdf': 'ready_to_copy',
      'second.pdf': 'ready_to_copy',
      'expired.pdf': 'link_expired',
      'nolink.pdf': 'no_link',
      'broken.pdf': 'ready_to_copy',
      'indraft.pdf': 'ready_to_copy',
      'indraftmodule.pdf': 'ready_to_copy',
      'nohub.pdf': 'lesson_not_in_hub',
    })
    // A draft lesson's file, and one under a draft module, are marked; the rest are members' to see.
    expect(plan.files.filter((f) => f.draft).map((f) => f.filename).sort()).toEqual(['indraft.pdf', 'indraftmodule.pdf'])
    expect(plan.courseId).toBe(ids.course)
    expect(plan.files.filter((f) => f.lessonTitle === 'Lesson a').map((f) => f.filename)).toEqual(['tracker.pdf', 'second.pdf']) // by position
  })

  it('copies each file once into the private bucket and records its size, type and hash', async () => {
    const result = await copyCourseFiles(supabase, COURSE, NOW, download)

    expect(result.copied.map((c) => c.filename).sort()).toEqual(['tracker.pdf', 'second.pdf', 'indraft.pdf', 'indraftmodule.pdf'].sort())
    expect(result.failed).toMatchObject([{ filename: 'broken.pdf', error: 'source answered 500' }])
    expect(result.needsNewLink.map((n) => `${n.filename}:${n.reason}`).sort()).toEqual(['expired.pdf:expired', 'nolink.pdf:missing'])
    expect(result.waitingForLesson).toBe(1)

    const stored = (await rows()).find((r) => r.source_key.endsWith('-f-tracker'))!
    expect(stored).toMatchObject({
      lesson_id: ids.a,
      filename: 'tracker.pdf',
      content_type: 'application/pdf', // S3 said octet-stream; the extension decides
      size_bytes: 'contents of tracker'.length,
      position: 1,
      storage_path: `${ids.course}/${ids.a}/${COURSE}-f-tracker-tracker.pdf`,
    })
    expect(stored.content_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await exists(stored.storage_path)).toBe(true)
    // A draft lesson's file, and one under a draft module, are copied onto their hidden Hub lessons.
    const draftRows = (await rows()).filter((r) => r.filename === 'indraft.pdf' || r.filename === 'indraftmodule.pdf')
    expect(draftRows.map((r) => r.lesson_id).sort()).toEqual([ids.draft, ids.c].sort())
  })

  it('copies nothing again, and retries only what failed', async () => {
    sources.broken = { body: 'fixed now' }
    const result = await copyCourseFiles(supabase, COURSE, NOW, download)

    expect(result.alreadyCopied).toBe(4)
    expect(result.copied.map((c) => c.filename)).toEqual(['broken.pdf'])
    expect((await rows()).filter((r) => r.filename.endsWith('.pdf'))).toHaveLength(5)
  })

  it('refuses a file over the size limit without storing it', async () => {
    await supabase.from('course_lesson_files').delete().like('source_key', `${COURSE}-f-broken`)
    sources.broken = { body: 'x'.repeat(1024) }
    const result = await copyCourseFiles(supabase, COURSE, NOW, (async () => new Response(Buffer.alloc(51 * 1024 * 1024), { status: 200 })) as typeof fetch)
    expect(result.failed).toMatchObject([{ filename: 'broken.pdf', error: 'larger than 50 MB' }])
    expect((await rows()).some((r) => r.source_key.endsWith('-f-broken'))).toBe(false)
  })

  it('removes a file (and its stored object) once Kajabi no longer lists it', async () => {
    const tracker = (await rows()).find((r) => r.source_key.endsWith('-f-tracker'))!
    await bronze.from('kajabi_lesson_files').update({ deleted_at: NOW.toISOString() }).eq('kajabi_id', `${COURSE}-f-tracker`)

    const plan = await planCourseFiles(createRepos(supabase), COURSE, NOW)
    expect(plan.stale.map((s) => s.filename)).toContain('tracker.pdf')

    const result = await copyCourseFiles(supabase, COURSE, NOW, download)
    expect(result.removed).toBeGreaterThanOrEqual(1)
    expect((await rows()).some((r) => r.source_key.endsWith('-f-tracker'))).toBe(false)
    expect(await exists(tracker.storage_path)).toBe(false)
  })

  it('reports a course that is not published as having nowhere to copy to', async () => {
    const plan = await planCourseFiles(createRepos(supabase), `${COURSE}-unpublished`, NOW)
    expect(plan.courseId).toBeNull()
    expect(plan.files).toEqual([])
  })
})
