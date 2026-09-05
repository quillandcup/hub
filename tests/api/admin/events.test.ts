import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for the events admin CRUD API (app/api/admin/events) and
 * the photo hide/unhide + authenticated photo-proxy routes.
 *
 * The Google Photos Picker OAuth/import flow itself isn't covered here --
 * it needs a real Google account and browser consent, so it's exercised
 * manually. The dedup/batching logic it depends on is unit-tested directly
 * in tests/lib/google-photos-picker-import-batch.test.ts. Here we simulate
 * an "already imported" photo by inserting an event_photos row directly
 * (bypassing Google), which is enough to test hide/unhide and the proxy
 * route's auth.
 */
describe('Events API', () => {
  const supabase = getTestSupabaseAdminClient()
  const baseUrl = getTestApiBaseUrl()
  const ts = Date.now()

  let eventId: string
  let photoId: string

  afterAll(async () => {
    if (eventId) await supabase.from('events').delete().eq('id', eventId)
  })

  it('GET returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/api/admin/events`)
    expect(res.status).toBe(401)
  })

  it('POST returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/api/admin/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: `x-${ts}`, title: 'x', event_type: 'other', starts_at: '2026-01-01', ends_at: '2026-01-01' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/admin/events creates an event', async () => {
    const response = await fetch(`${baseUrl}/api/admin/events`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: `test-retreat-${ts}`,
        title: `Test Retreat ${ts}`,
        event_type: 'in_person_retreat',
        location: 'Test Lakehouse',
        starts_at: '2026-05-01',
        ends_at: '2026-05-04',
        focus: 'Deep drafting',
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.event.slug).toBe(`test-retreat-${ts}`)
    eventId = body.event.id
  })

  it('GET /api/admin/events lists events with a photo count', async () => {
    const response = await fetch(`${baseUrl}/api/admin/events`, { headers: getTestAuthHeaders() })
    expect(response.ok).toBe(true)
    const body = await response.json()
    const found = body.events.find((e: any) => e.id === eventId)
    expect(found).toBeTruthy()
    expect(found.photo_count).toBe(0)
  })

  it('PATCH /api/admin/events/[id] updates the event', async () => {
    const response = await fetch(`${baseUrl}/api/admin/events/${eventId}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: 'Everyone finished a full draft' }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.event.results).toBe('Everyone finished a full draft')
  })

  it('sets up a fake imported photo (bypassing Google) to test hide/unhide', async () => {
    const { data: photo, error } = await supabase
      .from('event_photos')
      .insert({
        event_id: eventId,
        storage_path: `${eventId}/fake.jpg`,
        google_media_item_id: `fake-media-item-${ts}`,
        mime_type: 'image/jpeg',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    photoId = photo!.id
  })

  it('GET /api/admin/events/[id] returns the photo', async () => {
    const response = await fetch(`${baseUrl}/api/admin/events/${eventId}`, { headers: getTestAuthHeaders() })
    const body = await response.json()
    expect(body.photos.map((p: any) => p.id)).toContain(photoId)
  })

  it('PATCH photo hide sets hidden_at without deleting the row', async () => {
    const response = await fetch(`${baseUrl}/api/admin/events/${eventId}/photos/${photoId}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: true }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.photo.hidden_at).not.toBeNull()

    // Still present with its google_media_item_id intact -- this is what
    // keeps a hidden photo out of a re-synced import (see
    // tests/lib/google-photos-picker-import-batch.test.ts).
    const { data: row } = await supabase.from('event_photos').select('*').eq('id', photoId).single()
    expect(row).toBeTruthy()
    expect(row!.google_media_item_id).toBe(`fake-media-item-${ts}`)
  })

  it('a hidden photo is excluded from a hidden_at-is-null query (what the member gallery uses)', async () => {
    const { data } = await supabase.from('event_photos').select('id').eq('event_id', eventId).is('hidden_at', null)
    expect(data).toEqual([])
  })

  it('PATCH photo unhide clears hidden_at', async () => {
    const response = await fetch(`${baseUrl}/api/admin/events/${eventId}/photos/${photoId}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: false }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.photo.hidden_at).toBeNull()
  })

  it('GET /api/events/[eventId]/photos/[photoId] (the viewer proxy) returns 401 without auth', async () => {
    const response = await fetch(`${baseUrl}/api/events/${eventId}/photos/${photoId}`)
    expect(response.status).toBe(401)
  })

  it('DELETE /api/admin/events/[id] removes the event and its photos', async () => {
    const response = await fetch(`${baseUrl}/api/admin/events/${eventId}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })
    expect(response.ok).toBe(true)

    const { data: gone } = await supabase.from('events').select('id').eq('id', eventId).single()
    expect(gone).toBeNull()
    const { data: photosGone } = await supabase.from('event_photos').select('id').eq('id', photoId)
    expect(photosGone).toEqual([])
    eventId = ''
  })
})
