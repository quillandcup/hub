import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * member_status_overrides (gift, direct_stripe) must actually stick after
 * reprocessing — this is the fix for the bug where a manually-set 'active'
 * status got silently reverted to the Kajabi-derived value on every nightly
 * sync (see app/api/process/members/route.ts and the reprocess_members_atomic
 * override step it relies on). Hiatus has its own dedicated table and its
 * own reprocessability coverage — see member-hiatus-history.test.ts.
 */
describe('Member Status Overrides applied during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  const emailGift = `override-gift-${ts}@example.com`
  const emailExpired = `override-expired-${ts}@example.com`
  const emailDirectStripe = `override-direct-stripe-${ts}@example.com`

  let memberIds: Record<string, string> = {}
  const overrideIds: string[] = []

  async function processMembers() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/members`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} - ${await response.text()}`)
    }
    return response.json()
  }

  beforeAll(async () => {
    // Neither has a Bronze Kajabi contact, so nothing but the override step
    // touches their status. Both start 'cancelled' so the gift override
    // actually has to do something to reach 'active' — a no-op starting
    // status would make a broken override step undetectable.
    const { data: members, error } = await supabase.from('members').insert([
      { name: 'Override Gift', email: emailGift, joined_at: '2023-01-01', status: 'cancelled' },
      { name: 'Override Expired', email: emailExpired, joined_at: '2023-01-01', status: 'cancelled' },
      { name: 'Override Direct Stripe', email: emailDirectStripe, joined_at: '2023-01-01', status: 'cancelled' },
    ]).select('id, email')

    expect(error).toBeNull()
    members?.forEach(m => { memberIds[m.email] = m.id })

    const { data: overrides, error: overrideError } = await supabase
      .from('member_status_overrides')
      .insert([
        // Batch insert requires every row to specify the same columns explicitly —
        // supabase-js sends `null` (not "omit, use DB default") for a column absent
        // on a given row if any other row in the batch specifies it.
        { member_id: memberIds[emailGift], override_type: 'gift', reason: 'test gift', starts_at: new Date().toISOString() },
        {
          // Expired gift — should NOT apply, member stays whatever Kajabi says
          member_id: memberIds[emailExpired],
          override_type: 'gift',
          reason: 'test expired gift',
          starts_at: '2020-01-01T00:00:00Z',
          expires_at: '2020-06-01T00:00:00Z',
        },
        { member_id: memberIds[emailDirectStripe], override_type: 'direct_stripe', reason: 'test direct stripe', starts_at: new Date().toISOString() },
      ])
      .select('id')

    expect(overrideError).toBeNull()
    overrideIds.push(...(overrides?.map(o => o.id) ?? []))
  })

  afterAll(async () => {
    await supabase.from('member_status_overrides').delete().in('id', overrideIds)
    await supabase.from('members').delete().in('email', [emailGift, emailExpired, emailDirectStripe])
  })

  it('forces status to active for a gift override', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailGift).single()
    expect(member?.status).toBe('active')
  })

  it('does not apply an override whose expires_at is in the past', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailExpired).single()
    expect(member?.status).toBe('cancelled')
  })

  it('forces status to active for a direct_stripe override', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailDirectStripe).single()
    expect(member?.status).toBe('active')
  })
})
