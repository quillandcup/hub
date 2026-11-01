import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { COURSE_FILES_BUCKET, MAX_COURSE_FILE_BYTES } from '@/lib/courses/files'

/**
 * The actions that add and remove the downloads of a Hub-owned lesson, against the real database and the real
 * `course-files` bucket. Who is calling is faked. The file is sent the way the browser sends it: to the signed
 * upload the first action hands out.
 */

const ts = Date.now()
const PREFIX = `test-lfile-${ts}`

const auth = vi.hoisted(() => ({ admin: true }))
vi.mock('@/lib/admin-auth', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return {
    requireAdminAction: async () => (auth.admin ? { ok: true, user: { id: 'user-admin', email: 'admin@example.test' }, supabase: getTestSupabaseAdminClient() } : { ok: false, error: 'Not authorized' }),
  }
})
vi.mock('@/lib/analytics/server', () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))

// The service client the actions use, made to fail one way at a time: `sign` can't make an upload address, `big` finds
// a stored object over the limit, `writes` can't change the downloads table.
const fault = vi.hoisted(() => ({ mode: null as null | 'sign' | 'big' | 'writes' }))
vi.mock('@/lib/supabase/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/service')>('@/lib/supabase/service')
  return {
    createServiceRoleClient: () => {
      const client = actual.createServiceRoleClient()
      if (!fault.mode) return client
      return new Proxy(client, {
        get: (target, prop) => {
          if (prop === 'storage' && fault.mode === 'sign') {
            return { from: (b: string) => ({ ...target.storage.from(b), createSignedUploadUrl: async () => ({ data: null, error: { message: 'storage down' } }) }) }
          }
          if (prop === 'storage' && fault.mode === 'big') {
            return { from: (b: string) => { const real = target.storage.from(b); return { list: async (...a: Parameters<typeof real.list>) => { const r = await real.list(...a); return { ...r, data: r.data?.map((o) => ({ ...o, metadata: { ...o.metadata, size: 60 * 1024 * 1024 } })) ?? null } }, remove: (...a: Parameters<typeof real.remove>) => real.remove(...a) } } }
          }
          if (prop === 'from' && fault.mode === 'writes') {
            return (table: string) => {
              const real = target.from(table as 'courses')
              if (table !== 'course_lesson_files') return real
              return { select: (...a: unknown[]) => (real as any).select(...a), upsert: () => { throw new Error('connection lost') }, delete: () => { throw new Error('connection lost') } }
            }
          }
          return (target as any)[prop]
        },
      })
    },
  }
})

import { finishLessonFileUpload, removeLessonFile, startLessonFileUpload } from '@/app/(admin)/admin/courses/lesson-file-actions'

describe('Lesson file actions', () => {
  const supabase = getTestSupabaseAdminClient()
  const bucket = () => supabase.storage.from(COURSE_FILES_BUCKET)
  const ids: Record<string, string> = {}
  const notEditable = { error: expect.stringMatching(/can't be edited here/) }
  const rows = async () => (await supabase.from('course_lesson_files').select('*').eq('lesson_id', ids.lesson).order('position')).data ?? []
  const stored = async (path: string) => (await bucket().list(path.split('/').slice(0, -1).join('/'))).data?.some((o) => path.endsWith(`/${o.name}`)) ?? false

  /** Adds a file the way the browser does: ask for an address, send the bytes to it, then say it arrived. */
  const add = async (filename: string, body: string, type = 'application/pdf') => {
    const started = await startLessonFileUpload(ids.hub, ids.lesson, { filename, size: body.length })
    expect(started.error).toBeUndefined()
    const sent = await bucket().uploadToSignedUrl(started.path!, started.token!, new Blob([body], { type }), { contentType: type })
    expect(sent.error).toBeNull()
    return { started, finished: await finishLessonFileUpload(ids.hub, ids.lesson, { fileKey: started.fileKey!, filename, type }) }
  }

  beforeAll(async () => {
    await supabase.storage.createBucket(COURSE_FILES_BUCKET, { public: false })
    const insertCourse = async (slug: string, source: string) => (await supabase.from('courses').insert({ slug: `${PREFIX}-${slug}`, title: slug, source, ...(source === 'kajabi' ? { source_key: `${PREFIX}-${slug}` } : {}) }).select('id').single()).data!.id
    ids.hub = await insertCourse('hub', 'hub')
    ids.other = await insertCourse('other', 'hub')
    ids.kajabi = await insertCourse('kajabi', 'kajabi')
    ids.lesson = (await supabase.from('course_lessons').insert({ course_id: ids.hub, title: 'Lesson', position: 1, publishing_option: 'draft', source: 'hub' }).select('id').single()).data!.id
    ids.kajabiLesson = (await supabase.from('course_lessons').insert({ course_id: ids.kajabi, title: 'Imported', position: 1, publishing_option: 'published', state: 'open', source: 'kajabi', source_key: `${PREFIX}-l` }).select('id').single()).data!.id
  })
  beforeEach(() => {
    auth.admin = true
    fault.mode = null
    vi.clearAllMocks()
  })
  afterAll(async () => {
    const { data } = await supabase.from('course_lesson_files').select('storage_path').in('lesson_id', [ids.lesson])
    if (data?.length) await bucket().remove(data.map((r) => r.storage_path))
    await supabase.from('courses').delete().like('slug', `${PREFIX}%`)
  })

  describe('adding a file', () => {
    it('stores it in the bucket and records it for the lesson with the size the bucket has', async () => {
      const { started, finished } = await add('Tracker Sheet.pdf', 'twelve bytes')

      expect(finished).toEqual({ id: ids.lesson })
      expect(started.path).toBe(`${ids.hub}/${ids.lesson}/${started.fileKey}-Tracker_Sheet.pdf`)
      expect(await rows()).toEqual([expect.objectContaining({ filename: 'Tracker Sheet.pdf', source_key: started.fileKey, size_bytes: 12, content_type: 'application/pdf', storage_path: started.path, position: 1 })])
      expect(await stored(started.path!)).toBe(true)
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.hub}/lessons/${ids.lesson}`)
    })

    it('puts the next file after the ones the lesson has, and knows a type by the extension when the browser gave none', async () => {
      const { finished } = await add('Notes.txt', 'second', '')
      expect(finished).toEqual({ id: ids.lesson })
      const all = await rows()
      expect(all.map((r) => r.position)).toEqual([1, 2])
      expect(all[1]).toMatchObject({ filename: 'Notes.txt', content_type: 'text/plain' })
    })

    it('says so when the file never arrived, and records nothing', async () => {
      const started = await startLessonFileUpload(ids.hub, ids.lesson, { filename: 'Ghost.pdf', size: 10 })
      const before = (await rows()).length

      expect(await finishLessonFileUpload(ids.hub, ids.lesson, { fileKey: started.fileKey!, filename: 'Ghost.pdf', type: 'application/pdf' })).toEqual({ error: "The file didn't arrive. Try again." })
      expect(await rows()).toHaveLength(before)
    })

    it('says so when storage cannot make an upload address', async () => {
      fault.mode = 'sign'
      expect(await startLessonFileUpload(ids.hub, ids.lesson, { filename: 'a.pdf', size: 10 })).toEqual({ error: "Couldn't start the upload." })
    })

    it('removes a file that arrived larger than the limit, and records nothing', async () => {
      const started = await startLessonFileUpload(ids.hub, ids.lesson, { filename: 'Big.pdf', size: 10 })
      await bucket().uploadToSignedUrl(started.path!, started.token!, new Blob(['tiny']), { contentType: 'application/pdf' })
      const before = (await rows()).length

      fault.mode = 'big'
      expect(await finishLessonFileUpload(ids.hub, ids.lesson, { fileKey: started.fileKey!, filename: 'Big.pdf', type: 'application/pdf' })).toEqual({ error: 'That file is too large.' })
      fault.mode = null
      expect(await rows()).toHaveLength(before)
      expect(await stored(started.path!)).toBe(false)
    })

    it('says so when the database refuses the record, and leaves no object behind', async () => {
      const started = await startLessonFileUpload(ids.hub, ids.lesson, { filename: 'Lost.pdf', size: 10 })
      await bucket().uploadToSignedUrl(started.path!, started.token!, new Blob(['tiny']), { contentType: 'application/pdf' })
      const before = (await rows()).length

      fault.mode = 'writes'
      expect(await finishLessonFileUpload(ids.hub, ids.lesson, { fileKey: started.fileKey!, filename: 'Lost.pdf', type: 'application/pdf' })).toEqual({ error: "Couldn't save the file." })
      fault.mode = null
      expect(await rows()).toHaveLength(before)
      expect(await stored(started.path!)).toBe(false)
    })

    it("won't record a key this lesson didn't hand out, or a name it never signed for", async () => {
      expect(await finishLessonFileUpload(ids.hub, ids.lesson, { fileKey: 'up-../../x', filename: 'a.pdf', type: '' })).toEqual({ error: "That upload isn't one this lesson started." })
      expect(await finishLessonFileUpload(ids.hub, ids.lesson, { fileKey: 'up-123e4567-e89b-12d3-a456-426614174000', filename: '  ', type: '' })).toEqual({ error: "That upload isn't one this lesson started." })
      expect(await finishLessonFileUpload(ids.hub, ids.lesson, { fileKey: 'up-123e4567-e89b-12d3-a456-426614174000', filename: 'never.pdf', type: '' })).toEqual({ error: "The file didn't arrive. Try again." })
    })

    it('refuses a file with no name, an empty one, and one too large, before any address is made', async () => {
      expect(await startLessonFileUpload(ids.hub, ids.lesson, { filename: '', size: 10 })).toEqual({ error: 'That file has no name.' })
      expect(await startLessonFileUpload(ids.hub, ids.lesson, { filename: 'a.pdf', size: 0 })).toEqual({ error: 'That file is empty.' })
      expect(await startLessonFileUpload(ids.hub, ids.lesson, { filename: 'a.pdf', size: MAX_COURSE_FILE_BYTES + 1 })).toEqual({ error: 'That file is larger than 50 MB.' })
    })

    it("won't start or record one for another course's lesson, an imported course's, a missing one, or a bad id", async () => {
      expect(await startLessonFileUpload(ids.other, ids.lesson, { filename: 'a.pdf', size: 10 })).toEqual(notEditable)
      expect(await startLessonFileUpload(ids.kajabi, ids.kajabiLesson, { filename: 'a.pdf', size: 10 })).toEqual(notEditable)
      expect(await startLessonFileUpload(ids.hub, 'les_AAAAAAAAAAA1', { filename: 'a.pdf', size: 10 })).toEqual(notEditable)
      expect(await startLessonFileUpload('nope', ids.lesson, { filename: 'a.pdf', size: 10 })).toEqual(notEditable)
      expect(await finishLessonFileUpload(ids.kajabi, ids.kajabiLesson, { fileKey: 'up-123e4567-e89b-12d3-a456-426614174000', filename: 'a.pdf', type: '' })).toEqual(notEditable)
    })

    it("does nothing for someone who isn't an admin", async () => {
      auth.admin = false
      expect(await startLessonFileUpload(ids.hub, ids.lesson, { filename: 'a.pdf', size: 10 })).toEqual({ error: 'Not authorized' })
      expect(await finishLessonFileUpload(ids.hub, ids.lesson, { fileKey: 'up-123e4567-e89b-12d3-a456-426614174000', filename: 'a.pdf', type: '' })).toEqual({ error: 'Not authorized' })
    })
  })

  describe('removing a file', () => {
    it('removes it from the bucket and the lesson', async () => {
      const [file] = await rows()

      expect(await removeLessonFile(ids.hub, ids.lesson, file.id)).toEqual({ id: file.id })
      expect((await rows()).map((r) => r.id)).not.toContain(file.id)
      expect(await stored(file.storage_path)).toBe(false)
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${ids.hub}/lessons/${ids.lesson}`)
    })

    it('says so when the database refuses, and leaves the file on the lesson', async () => {
      const [file] = await rows()
      fault.mode = 'writes'
      expect(await removeLessonFile(ids.hub, ids.lesson, file.id)).toEqual({ error: "Couldn't remove the file." })
      fault.mode = null
      expect((await rows()).map((r) => r.id)).toContain(file.id)
      expect(await stored(file.storage_path)).toBe(true)
    })

    it("says so for a file that isn't there, one of another lesson, or an id that isn't one", async () => {
      expect(await removeLessonFile(ids.hub, ids.lesson, 'file_AAAAAAAAAAA1')).toEqual({ error: 'Not found.' })
      expect(await removeLessonFile(ids.hub, ids.lesson, 'nope')).toEqual({ error: 'Not found.' })
    })

    it("won't remove from another course's lesson or an imported one, or for a non-admin", async () => {
      const [file] = await rows()
      expect(await removeLessonFile(ids.other, ids.lesson, file.id)).toEqual(notEditable)
      expect(await removeLessonFile(ids.kajabi, ids.kajabiLesson, file.id)).toEqual(notEditable)
      auth.admin = false
      expect(await removeLessonFile(ids.hub, ids.lesson, file.id)).toEqual({ error: 'Not authorized' })
      expect((await rows()).map((r) => r.id)).toContain(file.id)
    })
  })
})
