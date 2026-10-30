import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { COURSE_IMAGES_BUCKET } from '@/lib/courses/images'
import { MEDIA_BUCKET } from '@/lib/media/library'

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

  describe('an image in the media library', () => {
    const assetIds: string[] = []
    const paths: string[] = []
    const libraryImage = async (key: string, bytes: Buffer, deleted = false) => {
      const path = `originals/shared/route-${ts}-${key}.png`
      await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true })
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
    afterAll(async () => {
      await supabase.storage.from(MEDIA_BUCKET).remove(paths)
      await supabase.from('course_lessons').update({ thumbnail_asset_id: null }).eq('course_id', ids.course)
      await supabase.from('courses').update({ thumbnail_asset_id: null, hero_asset_id: null }).eq('id', ids.course)
      await supabase.from('media_assets').delete().in('id', assetIds)
    })

    it('is streamed from the library, with its own content type, ahead of an older copy in the private bucket', async () => {
      const bytes = Buffer.from('LIBRARYDATA')
      await supabase.from('course_lessons').update({ thumbnail_asset_id: await libraryImage('open', bytes) }).eq('id', ids.open)
      as(false)
      const res = await get('lesson', 'open') // it also still has a thumbnail_path with PNGDATA
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
      expect(res.headers.get('cache-control')).toContain('private')
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('LIBRARYDATA')
    })

    it('serves a course cover and hero from the library by the course id', async () => {
      await supabase.from('courses').update({ thumbnail_asset_id: await libraryImage('cover', Buffer.from('COVER')), hero_asset_id: await libraryImage('hero', Buffer.from('HERO')) }).eq('id', ids.course)
      as(false)
      expect(Buffer.from(await (await get('course', 'course')).arrayBuffer()).toString()).toBe('COVER')
      expect(Buffer.from(await (await get('hero', 'course')).arrayBuffer()).toString()).toBe('HERO')
    })

    it("keeps a draft lesson's library image for staff acting as themselves, and 404s a row with nothing at all", async () => {
      await supabase.from('course_lessons').update({ thumbnail_asset_id: await libraryImage('draft', Buffer.from('DRAFT')), thumbnail_path: null }).eq('id', ids.draft)
      as(false)
      expect((await get('lesson', 'draft')).status).toBe(404)
      as(true)
      expect(Buffer.from(await (await get('lesson', 'draft')).arrayBuffer()).toString()).toBe('DRAFT')
      await supabase.from('course_lessons').update({ thumbnail_asset_id: null }).eq('id', ids.draft)
      expect((await get('lesson', 'draft')).status).toBe(404)
    })

    it('falls back to the older copy when its library image was deleted, and answers 404 when there is none', async () => {
      await supabase.from('course_lessons').update({ thumbnail_asset_id: await libraryImage('gone', Buffer.from('GONE'), true) }).eq('id', ids.open)
      as(false)
      expect(Buffer.from(await (await get('lesson', 'open')).arrayBuffer()).toString()).toBe('PNGDATA')
      await supabase.from('course_lessons').update({ thumbnail_asset_id: await libraryImage('gone2', Buffer.from('GONE'), true), thumbnail_path: null }).eq('id', ids.bare)
      expect((await get('lesson', 'bare')).status).toBe(404)
    })

    it('answers 502 when the library image is in the table but not in storage', async () => {
      const id = await libraryImage('lost', Buffer.from('LOST'))
      await supabase.storage.from(MEDIA_BUCKET).remove([paths[paths.length - 1]])
      await supabase.from('course_lessons').update({ thumbnail_asset_id: id }).eq('id', ids.bare)
      as(false)
      expect((await get('lesson', 'bare')).status).toBe(502)
    })
  })
})
