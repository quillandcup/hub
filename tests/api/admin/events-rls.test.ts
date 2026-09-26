import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'

/**
 * Exercises RLS on events / event_attendees / event_photos directly over PostgREST (not through
 * the requireAdmin-gated API routes): reads stay open to any signed-in user, but writes are
 * admin-only. See 20260926000400_restrict_event_writes_to_admins.sql.
 *
 * Note RLS semantics: a blocked INSERT returns an error, but a blocked UPDATE/DELETE just
 * matches zero rows -- so those cases are asserted by re-reading with the service-role client.
 */
describe('events / event_attendees / event_photos RLS', () => {
  const service = getTestSupabaseAdminClient()
  const ts = Date.now()
  const password = 'test-password-12345!'

  const authUserIds: string[] = []
  const memberIds: string[] = []
  const eventIds: string[] = []
  let eventId: string
  let photoId: string
  let memberClient: ReturnType<typeof getTestSupabaseClient>
  let adminClient: ReturnType<typeof getTestSupabaseClient>
  const anon = getTestSupabaseClient()

  async function signedInClient(email: string, role: 'member' | 'admin') {
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
    authUserIds.push(data.user.id)
    await service.from('user_profiles').update({ role }).eq('id', data.user.id)
    const client = getTestSupabaseClient()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`Failed to sign in: ${signInError.message}`)
    return client
  }

  async function newMember(label: string) {
    const { data } = await service
      .from('members')
      .insert({ name: `Events RLS ${label}`, email: `events-rls-${label}-${ts}@example.com`, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    memberIds.push(data!.id)
    return data!.id as string
  }

  const eventRow = (suffix: string) => ({
    slug: `events-rls-${suffix}-${ts}`,
    title: `Events RLS ${suffix} ${ts}`,
    event_type: 'other',
    starts_at: '2026-06-01',
    ends_at: '2026-06-01',
  })

  const readEvent = async () => (await service.from('events').select('title').eq('id', eventId).single()).data
  const readPhoto = async () => (await service.from('event_photos').select('hidden_at').eq('id', photoId).maybeSingle()).data
  const attendeeCount = async (memberId: string) =>
    (await service.from('event_attendees').select('id').eq('event_id', eventId).eq('member_id', memberId)).data?.length ?? 0

  let existingAttendee: string

  beforeAll(async () => {
    memberClient = await signedInClient(`events-rls-member-${ts}@example.com`, 'member')
    adminClient = await signedInClient(`events-rls-admin-${ts}@example.com`, 'admin')

    const { data: event } = await service.from('events').insert(eventRow('base')).select('id').single()
    eventId = event!.id
    eventIds.push(eventId)

    existingAttendee = await newMember('existing')
    await service.from('event_attendees').insert({ event_id: eventId, member_id: existingAttendee })

    const { data: photo } = await service
      .from('event_photos')
      .insert({ event_id: eventId, storage_path: `rls-test/${ts}.jpg`, google_media_item_id: `rls-test-${ts}` })
      .select('id')
      .single()
    photoId = photo!.id
  })

  afterAll(async () => {
    // Scoped cleanup only: ids this test created (cascades remove attendees/photos).
    if (eventIds.length) await service.from('events').delete().in('id', eventIds)
    if (memberIds.length) await service.from('members').delete().in('id', memberIds)
    for (const id of authUserIds) await service.auth.admin.deleteUser(id).catch(() => {})
  })

  describe.each([
    ['anon', () => anon],
    ['signed-in member', () => memberClient],
  ])('%s', (label, getClient) => {
    it('cannot insert, update or delete events', async () => {
      const client = getClient()
      const ins = await client.from('events').insert(eventRow(`denied-${label.replace(/\W/g, '')}`)).select('id')
      expect(ins.error).not.toBeNull()

      await client.from('events').update({ title: 'hijacked' }).eq('id', eventId)
      await client.from('events').delete().eq('id', eventId)
      expect((await readEvent())?.title).toBe(`Events RLS base ${ts}`)
    })

    it('cannot insert or delete event attendees', async () => {
      const client = getClient()
      const target = await newMember(`target-${label.replace(/\W/g, '')}`)
      const ins = await client.from('event_attendees').insert({ event_id: eventId, member_id: target })
      expect(ins.error).not.toBeNull()
      expect(await attendeeCount(target)).toBe(0)

      await client.from('event_attendees').delete().eq('event_id', eventId).eq('member_id', existingAttendee)
      expect(await attendeeCount(existingAttendee)).toBe(1)
    })

    it('cannot insert, update or delete event photos', async () => {
      const client = getClient()
      const ins = await client
        .from('event_photos')
        .insert({ event_id: eventId, storage_path: `rls-test/denied-${ts}.jpg`, google_media_item_id: `denied-${label}-${ts}` })
      expect(ins.error).not.toBeNull()

      await client.from('event_photos').update({ hidden_at: new Date().toISOString() }).eq('id', photoId)
      await client.from('event_photos').delete().eq('id', photoId)
      const photo = await readPhoto()
      expect(photo).not.toBeNull()
      expect(photo!.hidden_at).toBeNull()
    })
  })

  it('a signed-in member can still read events, attendees and photos', async () => {
    const [events, attendees, photos] = await Promise.all([
      memberClient.from('events').select('id').eq('id', eventId),
      memberClient.from('event_attendees').select('id').eq('event_id', eventId),
      memberClient.from('event_photos').select('id').eq('event_id', eventId),
    ])
    expect(events.data).toHaveLength(1)
    expect(attendees.data).toHaveLength(1)
    expect(photos.data).toHaveLength(1)
  })

  it('anon cannot read events', async () => {
    const { data } = await anon.from('events').select('id').eq('id', eventId)
    expect(data ?? []).toEqual([])
  })

  it('an admin session can insert, update and delete events', async () => {
    const { data: created, error } = await adminClient.from('events').insert(eventRow('admin')).select('id').single()
    expect(error).toBeNull()
    eventIds.push(created!.id)

    const upd = await adminClient.from('events').update({ title: `Events RLS admin-edited ${ts}` }).eq('id', created!.id).select('title')
    expect(upd.error).toBeNull()
    expect(upd.data).toEqual([{ title: `Events RLS admin-edited ${ts}` }])

    const del = await adminClient.from('events').delete().eq('id', created!.id).select('id')
    expect(del.error).toBeNull()
    expect(del.data).toHaveLength(1)
  })

  it('an admin session can add and remove attendees directly and via the RPCs', async () => {
    const target = await newMember('admin-target')
    expect((await adminClient.from('event_attendees').insert({ event_id: eventId, member_id: target })).error).toBeNull()
    expect(await attendeeCount(target)).toBe(1)
    expect((await adminClient.from('event_attendees').delete().eq('event_id', eventId).eq('member_id', target)).error).toBeNull()
    expect(await attendeeCount(target)).toBe(0)

    expect((await adminClient.rpc('add_event_attendee', { p_event_id: eventId, p_member_id: target, p_admin_id: null })).error).toBeNull()
    expect(await attendeeCount(target)).toBe(1)
    expect((await adminClient.rpc('remove_event_attendee', { p_event_id: eventId, p_member_id: target })).error).toBeNull()
    expect(await attendeeCount(target)).toBe(0)
  })

  it('a signed-in member cannot add attendees via the RPC either', async () => {
    const target = await newMember('rpc-target')
    const { error } = await memberClient.rpc('add_event_attendee', { p_event_id: eventId, p_member_id: target, p_admin_id: null })
    expect(error).not.toBeNull()
    expect(await attendeeCount(target)).toBe(0)
  })

  it('an admin session can insert, hide and delete photos', async () => {
    const { data: created, error } = await adminClient
      .from('event_photos')
      .insert({ event_id: eventId, storage_path: `rls-test/admin-${ts}.jpg`, google_media_item_id: `admin-${ts}` })
      .select('id')
      .single()
    expect(error).toBeNull()

    const hidden = await adminClient.from('event_photos').update({ hidden_at: new Date().toISOString() }).eq('id', created!.id).select('hidden_at')
    expect(hidden.error).toBeNull()
    expect(hidden.data?.[0].hidden_at).not.toBeNull()

    const del = await adminClient.from('event_photos').delete().eq('id', created!.id).select('id')
    expect(del.error).toBeNull()
    expect(del.data).toHaveLength(1)
  })
})
