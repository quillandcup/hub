import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { COURSE_IMAGES_BUCKET } from '@/lib/courses/images'

/**
 * The course image route: the private bucket is only reached through it, for a signed-in courses
 * user, and a hidden (draft) lesson's image is for staff acting as themselves only.
 */

const state = vi.hoisted(() => ({ caller: null as null | { scope: { memberId: string; isAdminActing: boolean } } }))
vi.mock('@/lib/courses/caller', () => ({ getCoursesCaller: async () => state.caller }))
vi.mock('@/lib/supabase/service', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() }
})

import { GET } from '@/app/api/courses/image/[kind]/[id]/route'
import type { NextRequest } from 'next/server'

const ts = Date.now()
const SOURCE = `test-img-route-${ts}`

describe('Course image route', () => {
  const supabase = getTestSupabaseAdminClient()
  const ids: Record<string, string> = {}
  const get = (kind: string, id: string) => GET({} as NextRequest, { params: Promise.resolve({ kind, id: ids[id] ?? id }) })
  const as = (staff: boolean | null) => {
    state.caller = staff === null ? null : { scope: { memberId: 'mbr_AAAAAAAAAAA1', isAdminActing: staff } }
  }
  const store = async (path: string) => {
    const { error } = await supabase.storage.from(COURSE_IMAGES_BUCKET).upload(path, Buffer.from('PNGDATA'), { contentType: 'image/png', upsert: true })
    expect(error).toBeNull()
  }

  beforeAll(async () => {
    await supabase.storage.createBucket(COURSE_IMAGES_BUCKET, { public: false })
    const { data: course } = await supabase.from('courses').insert({ slug: SOURCE, title: SOURCE, source_key: SOURCE, thumbnail_path: `${SOURCE}/cover.png`, hero_path: `${SOURCE}/hero.png` }).select('id').single()
    ids.course = course!.id
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, title: 'Open', position: 1, state: 'open', source_key: `${SOURCE}-o`, thumbnail_path: `${SOURCE}/o.png` },
        { course_id: ids.course, title: 'Draft', position: 2, state: 'hidden', source_key: `${SOURCE}-h`, thumbnail_path: `${SOURCE}/h.png` },
        { course_id: ids.course, title: 'Bare', position: 3, state: 'open', source_key: `${SOURCE}-b` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[l.title.toLowerCase()] = l.id
    for (const p of ['cover', 'hero', 'o', 'h']) await store(`${SOURCE}/${p}.png`)
  })
  afterAll(async () => {
    await supabase.storage.from(COURSE_IMAGES_BUCKET).remove(['cover', 'hero', 'o', 'h'].map((p) => `${SOURCE}/${p}.png`))
    await supabase.from('courses').delete().eq('source_key', SOURCE)
  })

  it('streams a course cover and an open lesson image to a signed-in courses user', async () => {
    as(false)
    const cover = await get('course', 'course')
    expect(cover.status).toBe(200)
    expect(cover.headers.get('content-type')).toBe('image/png')
    expect(cover.headers.get('cache-control')).toContain('private')
    expect(Buffer.from(await cover.arrayBuffer()).toString()).toBe('PNGDATA')
    expect((await get('lesson', 'open')).status).toBe(200)
  })

  it('streams a course hero banner to a courses user, by the course id', async () => {
    as(false)
    const hero = await get('hero', 'course')
    expect(hero.status).toBe(200)
    expect(Buffer.from(await hero.arrayBuffer()).toString()).toBe('PNGDATA')
    as(null)
    expect((await get('hero', 'course')).status).toBe(404)
    as(false)
    expect((await get('hero', 'les_AAAAAAAAAAA1')).status).toBe(404) // a lesson id is not a course id
  })

  it('answers 404 for no caller, a bad kind or id, a lesson without a copy and an unknown row', async () => {
    as(null)
    expect((await get('course', 'course')).status).toBe(404)
    as(false)
    expect((await get('banner', 'course')).status).toBe(404)
    expect((await get('lesson', 'course')).status).toBe(404) // a course id is not a lesson id
    expect((await get('lesson', 'bare')).status).toBe(404)
    expect((await get('lesson', 'les_AAAAAAAAAAA1')).status).toBe(404)
  })

  it("keeps a draft lesson's image for staff acting as themselves", async () => {
    as(false)
    expect((await get('lesson', 'draft')).status).toBe(404)
    as(true)
    expect((await get('lesson', 'draft')).status).toBe(200)
  })

  it('answers 502 when the row points at an object that is not in storage', async () => {
    await supabase.from('course_lessons').update({ thumbnail_path: `${SOURCE}/missing.png` }).eq('id', ids.bare)
    as(false)
    expect((await get('lesson', 'bare')).status).toBe(502)
  })
})
