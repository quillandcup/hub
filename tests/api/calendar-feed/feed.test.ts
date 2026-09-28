import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'
import { GET } from '@/app/api/calendar/feed/[token]/route'
import { slotTimeForInstant } from '@/lib/commitments'
import { SCHEDULE_TIMEZONE } from '@/lib/calendar-feed'

/**
 * Personal calendar feeds (supabase/migrations/20260928000000_create_calendar_feed_tokens.sql,
 * app/api/calendar/feed/[token]/route.ts): RLS on calendar_feed_tokens with real signed-in
 * sessions, and the feed route end to end against the local stack -- the token resolves to one
 * member, and the feed holds that member's hosted and committed prickles only.
 */
describe('calendar feed', () => {
  const admin = getTestSupabaseAdminClient()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'test-password-12345!'
  const ORIGIN = 'http://localhost:3000'
  const TOKEN_A = randomToken()
  const TOKEN_B = randomToken()

  const authUserIds: string[] = []
  const prickleIds: string[] = []
  let memberAId: string
  let memberBId: string
  let typeId: string
  let eduTypeId: string
  let eventId: string
  let addedOnceId: string
  let notAddedId: string
  let memberAClient: ReturnType<typeof getTestSupabaseClient>
  let adminClient: ReturnType<typeof getTestSupabaseClient>

  // Whole hours from now, so the committed prickle sits exactly on its UTC slot.
  const hourFromNow = (hours: number) => {
    const d = new Date(Date.now() + hours * 60 * 60 * 1000)
    d.setUTCMinutes(0, 0, 0)
    return d
  }
  const hostedByA = hourFromNow(48)
  const hostedByALongAgo = hourFromNow(-24 * 60)
  const hostedByB = hourFromNow(50)
  const committedByA = hourFromNow(72) // hosted by B, committed to by A
  // Added by hand by A (calendar_feed_items), all hosted by B, all of a second type:
  const addedOnce = hourFromNow(96) // "just this one"
  const weekly1 = hourFromNow(120) // "every week": this one and the next
  const weekly2 = new Date(weekly1.getTime() + 7 * 24 * 60 * 60 * 1000)
  const notAdded = hourFromNow(130) // same type, different slot: stays out
  const eventStart = hourFromNow(24 * 10).toISOString().slice(0, 10)
  const eventEnd = hourFromNow(24 * 12).toISOString().slice(0, 10)

  function randomToken() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  }

  async function createUser(email: string, role: 'member' | 'admin') {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`Failed to create test user ${email}: ${error?.message}`)
    authUserIds.push(data.user.id)
    await admin.from('user_profiles').update({ role }).eq('id', data.user.id)
    const client = getTestSupabaseClient()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`Failed to sign in as ${email}: ${signInError.message}`)
    return client
  }

  async function insertPrickle(start: Date, host: string, type = typeId) {
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const { data, error } = await admin
      .from('prickles')
      .insert({ type_id: type, host, start_time: start.toISOString(), end_time: end.toISOString(), source: 'calendar' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Failed to insert prickle: ${error?.message}`)
    prickleIds.push(data.id)
    return data.id as string
  }

  async function fetchFeed(segment: string) {
    const request = new NextRequest(`${ORIGIN}/api/calendar/feed/${segment}`)
    return GET(request, { params: Promise.resolve({ token: segment }) })
  }

  beforeAll(async () => {
    const emailA = `cal-feed-a-${suffix}@example.com`
    const emailB = `cal-feed-b-${suffix}@example.com`
    const { data: members, error: membersError } = await admin
      .from('members')
      .insert([
        { name: 'Feed Member Alpha', email: emailA, joined_at: '2023-01-01', status: 'active' },
        { name: 'Feed Member Bravo', email: emailB, joined_at: '2023-01-01', status: 'active' },
      ])
      .select('id, email')
    if (membersError || !members) throw new Error(`Failed to create members: ${membersError?.message}`)
    memberAId = members.find((m) => m.email === emailA)!.id
    memberBId = members.find((m) => m.email === emailB)!.id

    const { data: type, error: typeError } = await admin
      .from('prickle_types')
      .insert({ name: `Feed Type ${suffix}`, normalized_name: `feed-type-${suffix}` })
      .select('id')
      .single()
    if (typeError || !type) throw new Error(`Failed to create prickle type: ${typeError?.message}`)
    typeId = type.id

    const { data: eduType, error: eduTypeError } = await admin
      .from('prickle_types')
      .insert({ name: `Feed Edu ${suffix}`, normalized_name: `feed-edu-${suffix}` })
      .select('id')
      .single()
    if (eduTypeError || !eduType) throw new Error(`Failed to create prickle type: ${eduTypeError?.message}`)
    eduTypeId = eduType.id

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        slug: `feed-retreat-${suffix}`,
        title: `Feed Retreat ${suffix}`,
        event_type: 'in_person_retreat',
        location: 'Asheville, NC',
        starts_at: eventStart,
        ends_at: eventEnd,
      })
      .select('id')
      .single()
    if (eventError || !event) throw new Error(`Failed to create event: ${eventError?.message}`)
    eventId = event.id

    memberAClient = await createUser(emailA, 'member')
    adminClient = await createUser(`cal-feed-admin-${suffix}@example.com`, 'admin')

    await insertPrickle(hostedByA, memberAId)
    await insertPrickle(hostedByALongAgo, memberAId)
    await insertPrickle(hostedByB, memberBId)
    await insertPrickle(committedByA, memberBId)
    addedOnceId = await insertPrickle(addedOnce, memberBId, eduTypeId)
    await insertPrickle(weekly1, memberBId, eduTypeId)
    await insertPrickle(weekly2, memberBId, eduTypeId)
    notAddedId = await insertPrickle(notAdded, memberBId, eduTypeId)

    // A 1-week commitment by A to the UTC slot of `committedByA`.
    const { error: commitError } = await admin.rpc('create_prickle_commitment', {
      p_member_id: memberAId,
      p_start_date: committedByA.toISOString().slice(0, 10),
      p_weeks: 1,
      p_slots: [
        {
          type_id: typeId,
          day_of_week: committedByA.getUTCDay(),
          start_time_local: committedByA.toISOString().slice(11, 16),
          timezone: 'UTC',
        },
      ],
    })
    if (commitError) throw new Error(`Failed to create commitment: ${commitError.message}`)

    const { error: tokenError } = await admin.from('calendar_feed_tokens').insert([
      { member_id: memberAId, token: TOKEN_A },
      { member_id: memberBId, token: TOKEN_B },
    ])
    if (tokenError) throw new Error(`Failed to create tokens: ${tokenError.message}`)

    const weeklySlot = slotTimeForInstant(weekly1.toISOString(), SCHEDULE_TIMEZONE)
    const { error: itemsError } = await admin.from('calendar_feed_items').insert([
      { member_id: memberAId, kind: 'prickle', prickle_id: addedOnceId },
      {
        member_id: memberAId,
        kind: 'slot',
        type_id: eduTypeId,
        day_of_week: weeklySlot.dayOfWeek,
        start_time_local: weeklySlot.startTimeLocal,
        timezone: SCHEDULE_TIMEZONE,
      },
      { member_id: memberAId, kind: 'event', event_id: eventId },
    ])
    if (itemsError) throw new Error(`Failed to create calendar items: ${itemsError.message}`)
  })

  afterAll(async () => {
    if (prickleIds.length) await admin.from('prickles').delete().in('id', prickleIds)
    if (memberAId && memberBId) {
      await admin.from('prickle_commitments').delete().in('member_id', [memberAId, memberBId])
      // Tokens cascade from members.
      await admin.from('members').delete().in('id', [memberAId, memberBId])
    }
    if (typeId) await admin.from('prickle_types').delete().eq('id', typeId)
    if (eduTypeId) await admin.from('prickle_types').delete().eq('id', eduTypeId)
    if (eventId) await admin.from('events').delete().eq('id', eventId)
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {})
  })

  describe('calendar_feed_tokens RLS', () => {
    it("lets a member read their own token but not anyone else's", async () => {
      const { data } = await memberAClient.from('calendar_feed_tokens').select('member_id, token').in('member_id', [memberAId, memberBId])
      expect(data).toEqual([{ member_id: memberAId, token: TOKEN_A }])
    })

    it("stops a member from replacing someone else's token", async () => {
      const { data } = await memberAClient
        .from('calendar_feed_tokens')
        .update({ token: randomToken() })
        .eq('member_id', memberBId)
        .select('member_id')
      expect(data).toEqual([])
      const { data: row } = await admin.from('calendar_feed_tokens').select('token').eq('member_id', memberBId).single()
      expect(row!.token).toBe(TOKEN_B)
    })

    it('stops a member from creating a token for someone else', async () => {
      const { data: members } = await admin
        .from('members')
        .insert({ name: 'Feed Member Charlie', email: `cal-feed-c-${suffix}@example.com`, joined_at: '2023-01-01', status: 'active' })
        .select('id')
      const memberCId = members![0].id
      try {
        const { error } = await memberAClient.from('calendar_feed_tokens').insert({ member_id: memberCId, token: randomToken() })
        expect(error).toBeTruthy()
      } finally {
        await admin.from('members').delete().eq('id', memberCId)
      }
    })

    it('supports the app\'s create-if-missing and replace upserts under a member session', async () => {
      // getMyCalendarFeedUrls: create-if-missing keeps an existing token.
      const { error: keepError } = await memberAClient
        .from('calendar_feed_tokens')
        .upsert({ member_id: memberAId, token: randomToken() }, { onConflict: 'member_id', ignoreDuplicates: true })
      expect(keepError).toBeNull()
      const { data: kept } = await admin.from('calendar_feed_tokens').select('token').eq('member_id', memberAId).single()
      expect(kept!.token).toBe(TOKEN_A)

      // regenerateMyCalendarFeedToken: replace, then put the original back for the route tests.
      const replacement = randomToken()
      try {
        const { error: replaceError } = await memberAClient
          .from('calendar_feed_tokens')
          .upsert({ member_id: memberAId, token: replacement }, { onConflict: 'member_id' })
        expect(replaceError).toBeNull()
        const { data: replaced } = await admin.from('calendar_feed_tokens').select('token').eq('member_id', memberAId).single()
        expect(replaced!.token).toBe(replacement)
      } finally {
        await admin.from('calendar_feed_tokens').update({ token: TOKEN_A }).eq('member_id', memberAId)
      }
    })

    it("lets a member add and remove their own calendar items, and not see or touch anyone else's", async () => {
      const { data: added, error: addError } = await memberAClient
        .from('calendar_feed_items')
        .insert({ member_id: memberAId, kind: 'prickle', prickle_id: notAddedId })
        .select('id')
        .single()
      expect(addError).toBeNull()

      // Adding the same thing twice hits the unique index (the app treats 23505 as "already added").
      const { error: dupError } = await memberAClient
        .from('calendar_feed_items')
        .insert({ member_id: memberAId, kind: 'prickle', prickle_id: notAddedId })
      expect(dupError?.code).toBe('23505')

      const { error: otherError } = await memberAClient
        .from('calendar_feed_items')
        .insert({ member_id: memberBId, kind: 'event', event_id: eventId })
      expect(otherError).toBeTruthy()

      const { data: bItem } = await admin
        .from('calendar_feed_items')
        .insert({ member_id: memberBId, kind: 'event', event_id: eventId })
        .select('id')
        .single()
      try {
        const { data: visible } = await memberAClient.from('calendar_feed_items').select('member_id').eq('id', bItem!.id)
        expect(visible).toEqual([])
        await memberAClient.from('calendar_feed_items').delete().eq('id', bItem!.id)
        const { data: still } = await admin.from('calendar_feed_items').select('id').eq('id', bItem!.id)
        expect(still).toHaveLength(1)
      } finally {
        await admin.from('calendar_feed_items').delete().eq('id', bItem!.id)
      }

      const { error: removeError } = await memberAClient.from('calendar_feed_items').delete().eq('id', added!.id)
      expect(removeError).toBeNull()
      const { data: gone } = await admin.from('calendar_feed_items').select('id').eq('id', added!.id)
      expect(gone).toEqual([])
    })

    it('rejects an item whose columns don\'t match its kind', async () => {
      const { error } = await admin
        .from('calendar_feed_items')
        .insert({ member_id: memberAId, kind: 'event', event_id: eventId, type_id: eduTypeId })
      expect(error?.code).toBe('23514')
    })

    it('lets an admin read any token', async () => {
      const { data } = await adminClient.from('calendar_feed_tokens').select('member_id').in('member_id', [memberAId, memberBId])
      expect(data!.map((r) => r.member_id).sort()).toEqual([memberAId, memberBId].sort())
    })

    it('hides tokens from anonymous clients', async () => {
      const { data } = await getTestSupabaseClient().from('calendar_feed_tokens').select('token').in('member_id', [memberAId, memberBId])
      expect(data ?? []).toEqual([])
    })

    it('rejects a malformed token', async () => {
      const { error } = await admin.from('calendar_feed_tokens').update({ token: 'not-a-token' }).eq('member_id', memberBId)
      expect(error).toBeTruthy()
    })
  })

  describe('GET /api/calendar/feed/<token>.ics', () => {
    it("serves the member's hosted and committed prickles as iCalendar", async () => {
      const res = await fetchFeed(`${TOKEN_A}.ics`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
      expect(res.headers.get('cache-control')).toBe('private, no-store')

      const body = await res.text()
      const unfolded = body.replace(/\r\n /g, '')
      expect(unfolded.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)

      const starts = [...unfolded.matchAll(/^DTSTART:(\S+)$/gm)].map((m) => m[1])
      const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
      expect(starts).toEqual(
        [hostedByA, committedByA, addedOnce, weekly1, weekly2].sort((a, b) => a.getTime() - b.getTime()).map(utc)
      )
      expect(starts).not.toContain(utc(notAdded))
      expect(starts).not.toContain(utc(hostedByALongAgo))

      expect(unfolded).toContain(`SUMMARY:Hosting: Feed Type ${suffix}`)
      expect(unfolded).toContain(`SUMMARY:Feed Type ${suffix} with Feed B`)
      expect(unfolded).toContain('TRIGGER:-PT15M')
      expect(unfolded).toContain(`URL:${ORIGIN}/prickles/`)
      expect(unfolded).toContain(`SUMMARY:Feed Edu ${suffix} with Feed B`)
    })

    it('includes added events as all-day entries through their last day', async () => {
      const body = (await (await fetchFeed(`${TOKEN_A}.ics`)).text()).replace(/\r\n /g, '')
      const dayAfterEnd = new Date(new Date(`${eventEnd}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000)
      expect(body).toContain(`SUMMARY:Feed Retreat ${suffix}`)
      expect(body).toContain(`DTSTART;VALUE=DATE:${eventStart.replace(/-/g, '')}`)
      expect(body).toContain(`DTEND;VALUE=DATE:${dayAfterEnd.toISOString().slice(0, 10).replace(/-/g, '')}`)
      expect(body).toContain('LOCATION:Asheville\\, NC')
      expect(body).toContain(`URL:${ORIGIN}/events/feed-retreat-${suffix}`)
    })

    it("serves another member's token only that member's prickles", async () => {
      const body = (await (await fetchFeed(`${TOKEN_B}.ics`)).text()).replace(/\r\n /g, '')
      expect(body).toContain('SUMMARY:Hosting:')
      // B hosts every prickle here except A's own; A's commitment and additions don't leak into B's feed.
      expect([...body.matchAll(/^SUMMARY:Hosting:/gm)]).toHaveLength(6)
      expect([...body.matchAll(/^BEGIN:VEVENT$/gm)]).toHaveLength(6)
      expect(body).not.toContain('Part of your commitment')
      expect(body).not.toContain('Feed Retreat')
    })

    it('keeps an added prickle, under the same UID, when it is rescheduled', async () => {
      const uidFor = (body: string, start: Date) => {
        const utc = start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
        const event = body.split('BEGIN:VEVENT').find((e) => e.includes(`DTSTART:${utc}`))
        return event?.match(/^UID:(\S+)$/m)?.[1]
      }
      const before = (await (await fetchFeed(`${TOKEN_A}.ics`)).text()).replace(/\r\n /g, '')
      const moved = new Date(addedOnce.getTime() + 3 * 60 * 60 * 1000)
      await admin
        .from('prickles')
        .update({ start_time: moved.toISOString(), end_time: new Date(moved.getTime() + 60 * 60 * 1000).toISOString() })
        .eq('id', addedOnceId)
      try {
        const after = (await (await fetchFeed(`${TOKEN_A}.ics`)).text()).replace(/\r\n /g, '')
        expect(uidFor(after, moved)).toBeDefined()
        expect(uidFor(after, moved)).toBe(uidFor(before, addedOnce))
        expect(uidFor(after, addedOnce)).toBeUndefined()
      } finally {
        await admin
          .from('prickles')
          .update({ start_time: addedOnce.toISOString(), end_time: new Date(addedOnce.getTime() + 60 * 60 * 1000).toISOString() })
          .eq('id', addedOnceId)
      }
    })

    it('404s for an unknown or malformed token', async () => {
      expect((await fetchFeed(`${randomToken()}.ics`)).status).toBe(404)
      expect((await fetchFeed('not-a-token.ics')).status).toBe(404)
    })

    it('stops serving the old link once the token is replaced', async () => {
      const replacement = randomToken()
      await admin.from('calendar_feed_tokens').update({ token: replacement }).eq('member_id', memberBId)
      expect((await fetchFeed(`${TOKEN_B}.ics`)).status).toBe(404)
      expect((await fetchFeed(`${replacement}.ics`)).status).toBe(200)
    })
  })
})
