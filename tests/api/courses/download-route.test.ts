import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { COURSE_FILES_BUCKET } from '@/lib/courses/files'

/**
 * The lesson download route: the private bucket is only reached through it, after the same access
 * check as the lesson page. Real database and Storage; only who is signed in is faked.
 */

const state = vi.hoisted(() => ({
  caller: null as null | { scope: { memberId: string; isAdminActing: boolean } },
}))
vi.mock('@/lib/courses/caller', () => ({ getCoursesCaller: async () => state.caller }))
vi.mock('@/lib/supabase/service', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() }
})

import { GET } from '@/app/(member)/courses/[slug]/lessons/[lessonId]/files/[fileId]/route'
import type { NextRequest } from 'next/server'

const ts = Date.now()
const SLUG = `download-route-${ts}`
const SOURCE = `test-dl-${ts}`

describe('Lesson download route', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

  const get = (lesson: string, file: string, slug = SLUG) =>
    GET({} as NextRequest, { params: Promise.resolve({ slug, lessonId: ids[lesson] ?? lesson, fileId: ids[file] ?? file }) })
  const as = (who: string | null, isAdminActing = false) => {
    state.caller = who ? { scope: { memberId: ids[who], isAdminActing } } : null
  }

  beforeAll(async () => {
    await supabase.storage.createBucket(COURSE_FILES_BUCKET, { public: false })
    const now = new Date().toISOString()
    const { data: members } = await supabase
      .from('members')
      .insert(['current', 'ended', 'none', 'staff'].map((w) => ({ name: `DL ${w}`, email: `dl-${w}-${ts}@example.com`, joined_at: now, status: 'active' })))
      .select('id, email')
    for (const w of ['current', 'ended', 'none', 'staff']) ids[w] = members!.find((m) => m.email === `dl-${w}-${ts}@example.com`)!.id

    const { data: course } = await supabase.from('courses').insert({ slug: SLUG, title: `DL ${ts}`, source_key: SOURCE }).select('id').single()
    ids.course = course!.id
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, title: 'Open', position: 1, state: 'open', source_key: `${SOURCE}-open` },
        { course_id: ids.course, title: 'Soon', position: 2, state: 'coming_soon', source_key: `${SOURCE}-soon` },
        { course_id: ids.course, title: 'Other', position: 3, state: 'open', source_key: `${SOURCE}-other` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[l.title.toLowerCase()] = l.id

    const store = async (lessonKey: string, name: string) => {
      const path = `${ids.course}/${ids[lessonKey]}/${name}`
      const { error } = await supabase.storage.from(COURSE_FILES_BUCKET).upload(path, Buffer.from('%PDF-1.4 demo'), { contentType: 'application/pdf', upsert: true })
      expect(error).toBeNull()
      const { data } = await supabase.from('course_lesson_files').insert({ lesson_id: ids[lessonKey], source_key: `${SOURCE}-${name}`, filename: name, content_type: 'application/pdf', size_bytes: 13, storage_path: path }).select('id').single()
      return data!.id as string
    }
    ids.fileOpen = await store('open', 'Tracker Sheet.pdf')
    ids.fileSoon = await store('soon', 'Soon.pdf')
    ids.fileOther = await store('other', 'Other.pdf')

    await supabase.from('course_access').insert([
      { member_id: ids.current, course_id: ids.course, starts_at: days(-5), ends_at: days(300), origin: 'purchase' },
      { member_id: ids.ended, course_id: ids.course, starts_at: days(-500), ends_at: days(-100), origin: 'purchase' },
    ])
  })
  afterAll(async () => {
    const { data: rows } = await supabase.from('course_lesson_files').select('storage_path').like('source_key', `${SOURCE}-%`)
    if (rows?.length) await supabase.storage.from(COURSE_FILES_BUCKET).remove(rows.map((r) => r.storage_path))
    await supabase.from('courses').delete().eq('id', ids.course)
    await supabase.from('members').delete().like('email', `dl-%-${ts}@example.com`)
  })
  beforeEach(() => {
    state.caller = null
  })

  it('sends a member with access to a short-lived signed link that saves the file under its name', async () => {
    as('current')
    const response = await get('open', 'fileOpen')

    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const target = new URL(response.headers.get('location')!)
    expect(target.pathname).toContain(`/object/sign/${COURSE_FILES_BUCKET}/`)
    expect(target.searchParams.get('token')).toBeTruthy()
    expect(target.searchParams.get('download')).toBe('Tracker Sheet.pdf')
    // The signed link really serves the stored bytes.
    const served = await fetch(target)
    expect(served.status).toBe(200)
    expect(await served.text()).toBe('%PDF-1.4 demo')
  })

  it('is a plain 404 for everyone who could not open the lesson page', async () => {
    as(null)
    expect((await get('open', 'fileOpen')).status).toBe(404) // signed out, or courses off
    as('none')
    expect((await get('open', 'fileOpen')).status).toBe(404) // no access
    as('ended')
    expect((await get('open', 'fileOpen')).status).toBe(404) // access ended
    as('current')
    expect((await get('soon', 'fileSoon')).status).toBe(404) // coming soon, for a member
    as('staff', false)
    expect((await get('open', 'fileOpen')).status).toBe(404) // staff in sudo have no access of their own
  })

  it('lets staff acting as themselves open a coming-soon lesson\'s file (the preview)', async () => {
    as('staff', true)
    expect((await get('soon', 'fileSoon')).status).toBe(302)
  })

  it('does not hand out a file through a different lesson or course, or for a bad id', async () => {
    as('current')
    expect((await get('open', 'fileOther')).status).toBe(404) // another lesson's file
    expect((await get('open', 'fileOpen', 'no-such-course')).status).toBe(404)
    expect((await get('not-a-uuid', 'fileOpen')).status).toBe(404)
    expect((await get('open', 'not-a-uuid')).status).toBe(404)
    expect((await get('open', '00000000-0000-4000-a000-000000000000')).status).toBe(404)
  })
})
