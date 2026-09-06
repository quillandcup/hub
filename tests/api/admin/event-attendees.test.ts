import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for event attendees (app/api/admin/events/[id]/attendees) and their
 * interaction with badge auto-granting (badge_types.event_id / member_badges.event_id, see
 * 20260905010000_link_badges_to_events_and_attendees.sql). Exercises the real HTTP API end to
 * end -- the underlying SQL functions themselves were verified directly against a live Postgres
 * connection while developing the migration (dedup, idempotency, sync-after-linking all checked
 * there); this suite instead checks the routes wire them up correctly and enforce the
 * manual-award-is-disabled-once-linked rule.
 */
describe('Event Attendees + Badge Linking', () => {
  const supabase = getTestSupabaseAdminClient()
  const baseUrl = getTestApiBaseUrl()
  const ts = Date.now()

  let eventId: string
  let badgeTypeId: string
  let memberAId: string
  let memberBId: string

  beforeAll(async () => {
    const { data: memberA } = await supabase
      .from('members')
      .insert({ name: 'Attendee Test A', email: `attendee-a-${ts}@example.com`, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    memberAId = memberA!.id

    const { data: memberB } = await supabase
      .from('members')
      .insert({ name: 'Attendee Test B', email: `attendee-b-${ts}@example.com`, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    memberBId = memberB!.id
  })

  afterAll(async () => {
    if (badgeTypeId) await supabase.from('badge_types').delete().eq('id', badgeTypeId)
    if (eventId) await supabase.from('events').delete().eq('id', eventId)
    await supabase.from('members').delete().in('id', [memberAId, memberBId])
  })

  it('sets up an event and a retreat badge (unlinked)', async () => {
    const eventRes = await fetch(`${baseUrl}/api/admin/events`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: `attendee-test-retreat-${ts}`,
        title: `Attendee Test Retreat ${ts}`,
        event_type: 'in_person_retreat',
        starts_at: '2026-06-01',
        ends_at: '2026-06-03',
      }),
    })
    expect(eventRes.status).toBe(201)
    eventId = (await eventRes.json()).event.id

    const badgeRes = await fetch(`${baseUrl}/api/badge-types/create`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Attendee Test Badge ${ts}`, category: 'retreat' }),
    })
    expect(badgeRes.status).toBe(201)
    badgeTypeId = (await badgeRes.json()).badgeType.id
  })

  it('adding an attendee before the badge is linked records attendance but grants no badge', async () => {
    const res = await fetch(`${baseUrl}/api/admin/events/${eventId}/attendees`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: memberAId }),
    })
    expect(res.status).toBe(201)

    const { data: awards } = await supabase.from('member_badges').select('id').eq('member_id', memberAId).eq('badge_type_id', badgeTypeId)
    expect(awards).toEqual([])
  })

  it('linking the badge to the event backfills the badge for existing attendees (sync_event_badge_awards)', async () => {
    const res = await fetch(`${baseUrl}/api/badge-types/${badgeTypeId}/update`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Attendee Test Badge ${ts}`, category: 'retreat', eventId }),
    })
    expect(res.ok).toBe(true)

    const { data: awards } = await supabase.from('member_badges').select('event_id').eq('member_id', memberAId).eq('badge_type_id', badgeTypeId)
    expect(awards).toHaveLength(1)
    expect(awards![0].event_id).toBe(eventId)
  })

  it('adding a new attendee after linking auto-grants the badge', async () => {
    const res = await fetch(`${baseUrl}/api/admin/events/${eventId}/attendees`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: memberBId }),
    })
    expect(res.status).toBe(201)

    const { data: awards } = await supabase.from('member_badges').select('id, event_id').eq('member_id', memberBId).eq('badge_type_id', badgeTypeId)
    expect(awards).toHaveLength(1)
    expect(awards![0].event_id).toBe(eventId)
  })

  it('adding the same attendee again is a no-op, not a duplicate award', async () => {
    const res = await fetch(`${baseUrl}/api/admin/events/${eventId}/attendees`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: memberBId }),
    })
    expect(res.status).toBe(201)

    const { data: awards } = await supabase.from('member_badges').select('id').eq('member_id', memberBId).eq('badge_type_id', badgeTypeId)
    expect(awards).toHaveLength(1)
  })

  it('POST /api/member-badges/award rejects awarding a badge that is linked to an event', async () => {
    const res = await fetch(`${baseUrl}/api/member-badges/award`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: memberAId, badgeTypeId }),
    })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/member-badges/[id] rejects revoking an event-derived award', async () => {
    const { data: award } = await supabase
      .from('member_badges')
      .select('id')
      .eq('member_id', memberBId)
      .eq('badge_type_id', badgeTypeId)
      .single()

    const res = await fetch(`${baseUrl}/api/member-badges/${award!.id}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })
    expect(res.status).toBe(400)
  })

  it('removing an attendee revokes their event-derived award but leaves a separate manual award on another badge untouched', async () => {
    // Give memberB an unrelated manual badge to prove removal is scoped correctly.
    const { data: manualBadge } = await supabase
      .from('badge_types')
      .insert({ key: `manual_test_badge_${ts}`, name: `Manual Test Badge ${ts}`, category: 'special' })
      .select('id')
      .single()
    await supabase.from('member_badges').insert({ member_id: memberBId, badge_type_id: manualBadge!.id, occurred_at: '2026-01-01' })

    const res = await fetch(`${baseUrl}/api/admin/events/${eventId}/attendees/${memberBId}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })
    expect(res.ok).toBe(true)

    const { data: eventAward } = await supabase.from('member_badges').select('id').eq('member_id', memberBId).eq('badge_type_id', badgeTypeId)
    expect(eventAward).toEqual([])

    const { data: manualAward } = await supabase.from('member_badges').select('id').eq('member_id', memberBId).eq('badge_type_id', manualBadge!.id)
    expect(manualAward).toHaveLength(1)

    const { data: attendeeRow } = await supabase.from('event_attendees').select('id').eq('event_id', eventId).eq('member_id', memberBId)
    expect(attendeeRow).toEqual([])

    await supabase.from('badge_types').delete().eq('id', manualBadge!.id)
  })

  it('GET /api/admin/events/[id] reports the linked badge and current attendees', async () => {
    const res = await fetch(`${baseUrl}/api/admin/events/${eventId}`, { headers: getTestAuthHeaders() })
    const body = await res.json()
    expect(body.badgeType.id).toBe(badgeTypeId)
    expect(body.attendees.map((a: any) => a.memberId)).toEqual([memberAId])
  })
})
