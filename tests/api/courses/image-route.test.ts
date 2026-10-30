import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { MEDIA_BUCKET } from '@/lib/media/library'

/**
 * The course image route: the private media bucket is only reached through it, for a signed-in courses
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
  const assetIds: string[] = []
  const paths: string[] = []
  const get = (kind: string, id: string) => GET({} as NextRequest, { params: Promise.resolve({ kind, id: ids[id] ?? id }) })
  const as = (staff: boolean | null) => {
    state.caller = staff === null ? null : { scope: { memberId: 'mbr_AAAAAAAAAAA1', isAdminActing: staff } }
  }
  const body = async (res: Response) => Buffer.from(await res.arrayBuffer()).toString()

  /** A shared library image whose file holds `bytes`; deleted ones keep their file but are marked deleted. */
  const libraryImage = async (key: string, bytes: string, { deleted = false, inStorage = true } = {}) => {
    const path = `originals/shared/route-${ts}-${key}.png`
    if (inStorage) await supabase.storage.from(MEDIA_BUCKET).upload(path, Buffer.from(bytes), { contentType: 'image/png', upsert: true })
    paths.push(path)
    const { data, error } = await supabase
      .from('media_assets')
      .insert({ storage_path: path, mime_type: 'image/png', width: 1, height: 1, bytes: bytes.length, sha256: `route-${ts}-${key}`, title: key, source: 'kajabi', source_key: `https://kajabi.test/route-${ts}-${key}.png`, deleted_at: deleted ? new Date().toISOString() : null })
      .select('id')
      .single()
    expect(error).toBeNull()
    assetIds.push(data!.id)
    return data!.id
  }

  beforeAll(async () => {
    const { data: course } = await supabase
      .from('courses')
      .insert({ slug: SOURCE, title: SOURCE, source_key: SOURCE, thumbnail_asset_id: await libraryImage('cover', 'COVER'), hero_asset_id: await libraryImage('hero', 'HERO') })
      .select('id')
      .single()
    ids.course = course!.id
    const { data: lessons } = await supabase
      .from('course_lessons')
      .insert([
        { course_id: ids.course, title: 'Open', position: 1, state: 'open', source_key: `${SOURCE}-o`, thumbnail_asset_id: await libraryImage('open', 'OPEN') },
        { course_id: ids.course, title: 'Draft', position: 2, state: 'hidden', source_key: `${SOURCE}-h`, thumbnail_asset_id: await libraryImage('draft', 'DRAFT') },
        { course_id: ids.course, title: 'Bare', position: 3, state: 'open', source_key: `${SOURCE}-b` },
      ])
      .select('id, title')
    for (const l of lessons!) ids[l.title.toLowerCase()] = l.id
  })
  afterAll(async () => {
    await supabase.from('courses').delete().eq('source_key', SOURCE) // its lessons go with it
    await supabase.storage.from(MEDIA_BUCKET).remove(paths)
    await supabase.from('media_assets').delete().in('id', assetIds)
  })

  it('streams a course cover and an open lesson image to a signed-in courses user, with the image\'s own content type', async () => {
    as(false)
    const cover = await get('course', 'course')
    expect(cover.status).toBe(200)
    expect(cover.headers.get('content-type')).toBe('image/png')
    expect(cover.headers.get('cache-control')).toContain('private')
    expect(await body(cover)).toBe('COVER')
    expect(await body(await get('lesson', 'open'))).toBe('OPEN')
  })

  it('streams a course hero banner to a courses user, by the course id', async () => {
    as(false)
    const hero = await get('hero', 'course')
    expect(hero.status).toBe(200)
    expect(await body(hero)).toBe('HERO')
    as(null)
    expect((await get('hero', 'course')).status).toBe(404)
    as(false)
    expect((await get('hero', 'les_AAAAAAAAAAA1')).status).toBe(404) // a lesson id is not a course id
  })

  it('answers 404 for no caller, a bad kind or id, a lesson without an image and an unknown row', async () => {
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
    expect(await body(await get('lesson', 'draft'))).toBe('DRAFT')
  })

  it('answers 404 when the image was deleted from the library', async () => {
    await supabase.from('course_lessons').update({ thumbnail_asset_id: await libraryImage('gone', 'GONE', { deleted: true }) }).eq('id', ids.bare)
    as(false)
    expect((await get('lesson', 'bare')).status).toBe(404)
  })

  it('answers 502 when the image is in the table but not in storage', async () => {
    await supabase.from('course_lessons').update({ thumbnail_asset_id: await libraryImage('lost', 'LOST', { inStorage: false }) }).eq('id', ids.bare)
    as(false)
    expect((await get('lesson', 'bare')).status).toBe(502)
  })
})
